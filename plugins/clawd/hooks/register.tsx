import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionMessage } from 'claude-code'

import type { Alert } from '../types'

// =====================================================================
// Clawd: observador silencioso.
//
// 1. Triagem (modelo pequeno, antes de enviar): entende o prompt ditado por
//    voz, com vícios e erros de transcrição. Se estiver confuso, anexa para o
//    Claude a interpretação limpa, sem mexer no texto original.
// 2. Análise profunda (segundo plano, só se a triagem desconfiar): olha a
//    conversa inteira (fork do próprio transcript, servido do cache) e decide
//    se vale interromper.
// 3. Só aparece quando é crucial: uma linha acima do prompt com
//    "Parar e corrigir" / "Ignorar". Fora disso, fica invisível.
// =====================================================================

const alert = atom({ plugin: 'clawd', key: 'alert' } as const, null as Alert | null)
const runningTurn = atom({ plugin: 'clawd', key: 'runningTurn' } as const, null as string | null)
const thinking = atom({ plugin: 'clawd', key: 'thinking' } as const, false)

const NAME = 'Clawd'
const MIN_WORDS = 8
const TRIAGE_TIMEOUT_MS = 4000
const DEEP_TIMEOUT_MS = 45_000
const CRAB = '#FF6B4A'

// ---------------------------------------------------------------------
// Prompts do modelo
// ---------------------------------------------------------------------

const DICTATION = `O usuário dita os prompts por voz (português do Brasil). Espere vícios de fala ("tipo", "né", "aí", "cara", "mano", "sabe?", "entendeu?"), repetições, frases recomeçadas, falta de pontuação e erros de transcrição (palavras trocadas por outras de som parecido, termos técnicos deformados: "cloud" no lugar de "Claude", "rip o" no lugar de "repo", "díploi" no lugar de "deploy"). Isso é normal e NUNCA é um problema em si: interprete a intenção.`

export const TRIAGE_SYSTEM = `Você é ${NAME}, um observador silencioso que acompanha a conversa de uma pessoa com o Claude.
${DICTATION}

Leia o trecho recente da conversa e o NOVO prompt. Responda SÓ com um JSON, sem texto em volta:
{"messy": boolean, "clean": string, "flag": "none" | "check", "why": string}

- "messy": true só se a transcrição estiver bagunçada a ponto de o Claude poder entender errado.
- "clean": se messy, reescreva o prompt de forma fiel e direta, em português, mantendo TUDO o que a pessoa pediu, sem acrescentar nada. Se não, "".
- "flag": "check" SOMENTE se houver sinal de algo crucial:
  • um provável erro de transcrição que muda o sentido de uma ação (ex.: "deletar" vs "deployar");
  • ambiguidade que provavelmente faz o Claude construir a coisa errada;
  • contradição com algo combinado antes na conversa;
  • ação destrutiva ou irreversível que parece pedida por engano;
  • falta uma informação sem a qual o trabalho será desperdiçado.
  Na dúvida, "none". A grande maioria dos prompts é "none".
- "why": uma frase curta explicando o "check" (ou "").`

export const deepPrompt = (text: string, clean: string, why: string) => `[${NAME}: observador; esta mensagem é uma verificação interna, não é da pessoa]
${DICTATION}

A pessoa acabou de enviar este novo prompt (ditado):
<<<
${text}
>>>
${clean ? `Interpretação limpa provável: ${clean}\n` : ''}A triagem levantou uma suspeita: ${why}

Com toda a conversa acima como contexto, decida se o Claude deve ser INTERROMPIDO antes de seguir com esse prompt. Seja muito conservador: intervenha só se seguir como está provavelmente vai desperdiçar trabalho significativo, contradizer algo combinado, ou causar dano. Vícios de fala e erros de transcrição que não mudam o sentido NÃO justificam intervir.

Responda SÓ com um JSON:
{"intervene": boolean, "message": string, "corrected_prompt": string}
- "message": até 140 caracteres, em português, direto ao ponto, dizendo o que está errado.
- "corrected_prompt": o prompt completo que a pessoa deveria enviar no lugar, escrito como ela (primeira pessoa), claro e sem vícios.`

// ---------------------------------------------------------------------
// Utilidades puras
// ---------------------------------------------------------------------

/** Extrai o primeiro objeto JSON de uma resposta de modelo. */
export const parseJson = <T,>(raw: string): T | null => {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(raw.slice(start, end + 1)) as T
  } catch {
    return null
  }
}

export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length

/** Trecho recente da conversa, curto, para a triagem. */
export const excerpt = (msgs: readonly SessionMessage[], max = 6) =>
  msgs
    .filter(m => m.text.trim())
    .slice(-max)
    .map(m => `${m.role === 'user' ? 'Pessoa' : 'Claude'}: ${m.text.trim().slice(0, 600)}`)
    .join('\n\n')

export type Triage = { messy: boolean; clean: string; flag: 'none' | 'check'; why: string }
export type Deep = { intervene: boolean; message: string; corrected_prompt: string }

export const validTriage = (t: Triage | null): t is Triage =>
  !!t && typeof t.messy === 'boolean' && typeof t.clean === 'string' && (t.flag === 'none' || t.flag === 'check')

export const validDeep = (d: Deep | null): d is Deep =>
  !!d && d.intervene === true && typeof d.message === 'string' && d.message.trim().length > 0 &&
  typeof d.corrected_prompt === 'string' && d.corrected_prompt.trim().length > 0

export const cleanContext = (clean: string) =>
  `Nota do ${NAME} (observador): o prompt acima foi ditado por voz e pode ter erros de transcrição e vícios de fala. Interpretação provável do que a pessoa quis dizer: ${clean}`

// ---------------------------------------------------------------------
// Funções com $
// ---------------------------------------------------------------------

async function triage($: EngineInterface, text: string): Promise<Triage | null> {
  let recent = ''
  try {
    const msgs = await $.session.messages()
    if (Array.isArray(msgs)) recent = excerpt(msgs)
  } catch {}
  const r = await $.model.complete({
    model: 'haiku',
    system: TRIAGE_SYSTEM,
    prompt: `${recent ? `Trecho recente da conversa:\n${recent}\n\n` : ''}NOVO prompt:\n<<<\n${text}\n>>>`,
    maxTokens: 700,
    effort: 'low',
    timeoutMs: TRIAGE_TIMEOUT_MS,
  })
  if (!r.isAnswered) return null
  const t = parseJson<Triage>(r.text)
  return validTriage(t) ? t : null
}

async function deepCheck($: EngineInterface, text: string, t: Triage) {
  await update($, thinking, () => true)
  try {
    const r = await Promise.race([
      $.model.fork({ prompt: deepPrompt(text, t.messy ? t.clean : '', t.why) }),
      $.clock.sleep(DEEP_TIMEOUT_MS).then(() => null),
    ])
    if (!r || !r.isAnswered) return
    const d = parseJson<Deep>(r.text)
    if (!validDeep(d)) return
    const now = await $.clock.now()
    const turnId = await read($, runningTurn)
    await update($, alert, () => ({ message: d.message.trim().slice(0, 200), corrected: d.corrected_prompt.trim(), turnId, at: now }))
    try {
      const sent = await $.ui.notify(d.message, { title: `🦀 ${NAME}` })
      if (!sent.isSent) $.ui.toast(`🦀 ${NAME}: ${d.message}`, { timeoutMs: 8000 })
    } catch {
      $.ui.toast(`🦀 ${NAME}: ${d.message}`, { timeoutMs: 8000 })
    }
  } catch {
    // Observador nunca atrapalha: qualquer falha é silenciosa.
  } finally {
    await update($, thinking, () => false)
  }
}

async function enabled($: EngineInterface) {
  try {
    return (await $.store.get('enabled')) !== false
  } catch {
    return true
  }
}

async function stopAndFix($: EngineInterface) {
  const a = await read($, alert)
  if (!a) return
  const running = await read($, runningTurn)
  await update($, alert, () => null)
  if (running) {
    try {
      await $.turn.abort({ turnId: running })
    } catch {}
    await $.prompt.submit({ text: a.corrected })
  } else {
    // O Claude já terminou: deixa a correção pronta na caixa de texto.
    await $.prompt.fill({ text: a.corrected })
  }
}

async function dismiss($: EngineInterface) {
  await update($, alert, () => null)
}

// ---------------------------------------------------------------------
// Registro
// ---------------------------------------------------------------------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'clawd', description: `Liga ou desliga o ${NAME} (observador): /clawd on | off` })
    return next(e)
  })

  on('command.run', { command: 'clawd' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'off' || arg === 'desligar') {
      await $.store.set('enabled', false)
      await update($, alert, () => null)
      return { text: `🦀 ${NAME} desligado.` }
    }
    if (arg === 'on' || arg === 'ligar') {
      await $.store.set('enabled', true)
      return { text: `🦀 ${NAME} ligado: observando em silêncio.` }
    }
    return { text: `🦀 ${NAME} está ${(await enabled($)) ? 'ligado' : 'desligado'}. Use /clawd on ou /clawd off.` }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await update($, runningTurn, () => e.turnId)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if ((e as { agentId?: string }).agentId === undefined) await update($, runningTurn, () => null)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    // Só prompts que a pessoa digitou/ditou; nada de comandos, metas ou do próprio Clawd.
    const kind = (e as { origin?: { kind?: string } }).origin?.kind
    const fromPerson = kind === undefined || kind === 'composer'
    if (!fromPerson || e.command || e.isMeta || wordCount(e.text) < MIN_WORDS) return next(e)

    // Qualquer falha do observador deixa o prompt seguir intacto.
    let t: Triage | null = null
    try {
      if (!(await enabled($))) return next(e)
      // Um alerta antigo perde o sentido quando chega um prompt novo.
      await update($, alert, () => null)
      t = await triage($, e.text)
    } catch {}
    if (!t) return next(e)

    const ctx = t.messy && t.clean.trim() ? [...(e.context ?? []), cleanContext(t.clean.trim())] : e.context
    const result = await next(ctx === e.context ? e : { ...e, context: ctx })

    // Análise profunda em segundo plano, só quando a triagem desconfiou.
    if (t.flag === 'check') void deepCheck($, e.text, t)
    return result
  })

  // Desenho: aparece só com um alerta; fora disso deixa a faixa para quem vem depois.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const a = await read($, alert)
    if (!a) return next(e)
    const running = await read($, runningTurn)
    const { Box, Text, Button } = $.ui.resolve(e)
    const narrow = e.props.bodyColumns < 70
    return (
      <Box key="clawd-alert" flexDirection="row" flexWrap="nowrap" alignItems="center" columnGap={2} paddingX={1} width="100%">
        <Box flexDirection="row" flexGrow={1} flexShrink={1} overflow="hidden">
          <Text wrap="truncate-end">
            <Text color={CRAB} weight="semibold">🦀 {NAME}: </Text>
            <Text>{a.message}</Text>
          </Text>
        </Box>
        <Box flexDirection="row" columnGap={1} flexShrink={0}>
          <Button key="clawd-fix" variant="primary" label={running ? (narrow ? 'Parar' : 'Parar e corrigir') : (narrow ? 'Corrigir' : 'Usar correção')} onPress={() => stopAndFix($)} />
          <Button key="clawd-dismiss" plain dimColor label="Ignorar" onPress={() => dismiss($)} />
        </Box>
      </Box>
    )
  })
}
