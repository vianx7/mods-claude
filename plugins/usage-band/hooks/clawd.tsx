import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptSubmitInput, RenderElement, SessionMessage } from 'claude-code'

import type { Alert, LogEntry, Mode, Stats } from '../types'

const lastReply = atom({ plugin: 'usage-band', key: 'lastReply' } as const, null as number | null)
const clawdAlert = atom({ plugin: 'usage-band', key: 'clawdAlert' } as const, null as Alert | null)
const runningTurn = atom({ plugin: 'usage-band', key: 'runningTurn' } as const, null as string | null)
const clawdThinking = atom({ plugin: 'usage-band', key: 'clawdThinking' } as const, false)
const bypassOnce = atom({ plugin: 'usage-band', key: 'bypassOnce' } as const, false)
const clawdLog = atom({ plugin: 'usage-band', key: 'clawdLog' } as const, [] as LogEntry[])

// =====================================================================
// Clawd: observador silencioso que mora no fim da faixa e economiza tokens.
//
// 1. Pré-filtro grátis: só chama modelo quando o prompt tem cara de ditado
//    bagunçado ou fala de algo arriscado (modo "economia", o padrão).
// 2. Triagem (Haiku, enxuta): entende o ditado; se confuso, anexa para o
//    Claude a interpretação limpa, sem mexer no seu texto.
// 3. Análise profunda (só se a triagem desconfiar): fork da própria conversa,
//    servido do cache.
// 4. Conversa fria (grátis): segura o prompt antes de reler uma conversa
//    grande sem desconto e oferece compactar.
// =====================================================================

export const NAME = 'Clawd'
export const MENU = 'clawd-menu'
const MIN_WORDS = 8
const TRIAGE_TIMEOUT_MS = 4000
const DEEP_TIMEOUT_MS = 45_000
const CACHE_MS = 60 * 60_000
const COLD_BIG_TOKENS = 40_000
export const CRAB = '#FF6B4A'
const CRAB_OFF = '#8E8E93'

const ZERO: Stats = { triaged: 0, skipped: 0, deep: 0, alerts: 0, coldHolds: 0, tokens: 0 }

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

/** Trecho recente e curto da conversa (economia: poucas mensagens, cortadas). */
export const excerpt = (msgs: readonly SessionMessage[], max = 3, chars = 400) =>
  msgs
    .filter(m => m.text.trim())
    .slice(-max)
    .map(m => `${m.role === 'user' ? 'Pessoa' : 'Claude'}: ${m.text.trim().slice(0, chars)}`)
    .join('\n\n')

const FILLERS = ['tipo', 'né', 'ne', 'aí', 'ai', 'cara', 'mano', 'velho', 'sabe', 'entendeu', 'tá', 'ta', 'tipo assim', 'assim', 'então', 'enfim', 'beleza', 'bom', 'pô', 'po', 'meio que', 'e tal', 'pra poder']
// Ações destrutivas, irreversíveis ou que saem para o mundo (onde um erro de transcrição custa caro).
const RISKY = /(?:^|[^\p{L}])(delet\p{L}*|apag\p{L}*|remov\p{L}*|exclu\p{L}*|drop|truncate|reset\p{L}*|rm|force|sobrescrev\p{L}*|produção|prod|deploy\p{L}*|díploi|publica\p{L}*|publique|publicar|push|merge|migra\p{L}*|pagamento\p{L}*|cobran\p{L}*|reembols\p{L}*)(?=$|[^\p{L}])/iu

/** Pré-filtro grátis: vale chamar o modelo para este prompt? */
export const worthTriage = (text: string): { yes: boolean; why: 'risky' | 'messy' | 'clean' } => {
  if (RISKY.test(text)) return { yes: true, why: 'risky' }
  const lower = ` ${text.toLowerCase().replace(/[^\p{L}\s]/gu, ' ')} `
  const words = wordCount(text)
  const fillers = FILLERS.reduce((n, f) => n + (lower.split(` ${f} `).length - 1), 0)
  const noPunct = words >= 25 && !/[.,;:!?]/.test(text)
  const repeats = /\b(\p{L}+)\s+\1\b/iu.test(text)
  const score = fillers / Math.max(1, words) * 10 + (noPunct ? 1 : 0) + (repeats ? 0.5 : 0)
  return score >= 1 ? { yes: true, why: 'messy' } : { yes: false, why: 'clean' }
}

export type Triage = { messy: boolean; clean: string; flag: 'none' | 'check'; why: string }
export type Deep = { intervene: boolean; message: string; corrected_prompt: string }

export const validTriage = (t: Triage | null): t is Triage =>
  !!t && typeof t.messy === 'boolean' && typeof t.clean === 'string' && (t.flag === 'none' || t.flag === 'check')

export const validDeep = (d: Deep | null): d is Deep =>
  !!d && d.intervene === true && typeof d.message === 'string' && d.message.trim().length > 0 &&
  typeof d.corrected_prompt === 'string' && d.corrected_prompt.trim().length > 0

export const cleanContext = (clean: string) =>
  `Nota do ${NAME} (observador): o prompt acima foi ditado por voz e pode ter erros de transcrição e vícios de fala. Interpretação provável do que a pessoa quis dizer: ${clean}`

export const fmtTokens = (t: number) =>
  t >= 1_000_000 ? `${(t / 1_000_000).toFixed(1)}M` : t >= 1000 ? `${Math.round(t / 1000)}k` : `${t}`

const usedTokens = (u: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } | undefined) =>
  (u?.input_tokens ?? 0) + (u?.output_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0)

const hhmm = (t: number) => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

// ---------------------------------------------------------------------
// O caranguejo (desenho próprio, vetorial)
// ---------------------------------------------------------------------

export type CrabMood = 'idle' | 'thinking' | 'off'

/** Pinça: círculo com uma fatia aberta para cima. */
const pincer = (cx: number, cy: number, r: number, from: number, to: number) => {
  const p = (deg: number) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)].map(n => n.toFixed(2))
  const [x1, y1] = p(to)
  const [x2, y2] = p(from)
  return `M${cx} ${cy} L${x1} ${y1} A${r} ${r} 0 1 1 ${x2} ${y2} Z`
}

export const crabSvg = (mood: CrabMood) => {
  const c = mood === 'off' ? CRAB_OFF : CRAB
  const line = `stroke="${c}" stroke-width="1.5" stroke-linecap="round" fill="none"`
  const eyes = mood === 'off'
    ? `<path d="M8.6 5.4h2.2M13.2 5.4h2.2" stroke="${c}" stroke-width="1.3" stroke-linecap="round"/>`
    : `<g class="eyes"><circle cx="9.7" cy="5.2" r="1.7" fill="#fff"/><circle cx="14.3" cy="5.2" r="1.7" fill="#fff"/>` +
      `<circle class="pup" cx="10" cy="5.5" r=".8" fill="#1C1C1E"/><circle class="pup" cx="14.6" cy="5.5" r=".8" fill="#1C1C1E"/></g>`
  const css = mood === 'thinking'
    ? `.cl{animation:p .5s ease-in-out infinite alternate}.cr{animation:q .5s ease-in-out infinite alternate}` +
      `@keyframes p{to{transform:rotate(-14deg)}}@keyframes q{to{transform:rotate(14deg)}}` +
      `.pup{animation:l 1.2s ease-in-out infinite alternate}@keyframes l{from{transform:translateX(-.5px)}to{transform:translateX(.5px)}}`
    : mood === 'idle'
      ? `.eyes{transform-origin:12px 5.2px;animation:b 5s infinite}@keyframes b{0%,94%,100%{transform:scaleY(1)}97%{transform:scaleY(.1)}}` +
        `.body{animation:s 7s ease-in-out infinite}@keyframes s{0%,80%,100%{transform:translateX(0)}86%{transform:translateX(.7px)}92%{transform:translateX(-.7px)}}`
      : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="20" viewBox="0 0 24 20">` +
    `<style>.cl{transform-origin:6.2px 9.8px}.cr{transform-origin:17.8px 9.8px}${css}@media (prefers-reduced-motion: reduce){*{animation:none!important}}</style>` +
    `<g class="body">` +
    `<path d="M7.6 14.2 4.6 16.4M8.4 15.4 6.6 18.2M16.4 14.2l3 2.2M15.6 15.4l1.8 2.8" ${line}/>` +
    `<path d="M9.7 6.8v1.6M14.3 6.8v1.6" ${line}/>` +
    `<g class="cl"><path d="M7.6 11.2 5.6 9.4" ${line}/><path d="${pincer(4.2, 7.4, 2.7, -150, -80)}" fill="${c}"/></g>` +
    `<g class="cr"><path d="M16.4 11.2l2-1.8" ${line}/><path d="${pincer(19.8, 7.4, 2.7, -100, -30)}" fill="${c}"/></g>` +
    `<ellipse cx="12" cy="12.4" rx="6.4" ry="4.4" fill="${c}"/>` +
    `<ellipse cx="12" cy="10.9" rx="3.8" ry="1.4" fill="#fff" fill-opacity=".22"/>` +
    eyes +
    `</g></svg>`
}

// ---------------------------------------------------------------------
// Funções com $
// ---------------------------------------------------------------------

export async function clawdOn($: EngineInterface) {
  try {
    return (await $.store.get('clawd:enabled')) !== false
  } catch {
    return true
  }
}

async function coldGuardOn($: EngineInterface) {
  try {
    return (await $.store.get('clawd:coldGuard')) !== false
  } catch {
    return true
  }
}

async function getMode($: EngineInterface): Promise<Mode> {
  try {
    const m = await $.store.get('clawd:mode')
    return m === 'always' || m === 'free' ? m : 'economy'
  } catch {
    return 'economy'
  }
}

async function getStats($: EngineInterface): Promise<Stats> {
  try {
    const s = (await $.store.get('clawd:stats')) as Partial<Stats> | undefined
    return { ...ZERO, ...(s ?? {}) }
  } catch {
    return { ...ZERO }
  }
}

async function bump($: EngineInterface, change: Partial<Stats>) {
  try {
    const s = await getStats($)
    for (const k of Object.keys(change) as (keyof Stats)[]) s[k] += change[k] ?? 0
    await $.store.set('clawd:stats', s)
  } catch {}
}

async function note($: EngineInterface, text: string) {
  const now = await $.clock.now()
  await update($, clawdLog, l => [{ at: now, text }, ...l].slice(0, 8))
}

async function raise($: EngineInterface, a: Alert) {
  await update($, clawdAlert, () => a)
  await bump($, { alerts: 1 })
  await note($, a.message)
  try {
    const sent = await $.ui.notify(a.message, { title: `🦀 ${NAME}` })
    if (!sent.isSent) $.ui.toast(`🦀 ${NAME}: ${a.message}`, { timeoutMs: 8000 })
  } catch {
    $.ui.toast(`🦀 ${NAME}: ${a.message}`, { timeoutMs: 8000 })
  }
}

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
    maxTokens: 500,
    effort: 'low',
    timeoutMs: TRIAGE_TIMEOUT_MS,
  })
  if (!r.isAnswered) return null
  await bump($, { triaged: 1, tokens: usedTokens(r.usage) })
  const t = parseJson<Triage>(r.text)
  return validTriage(t) ? t : null
}

async function deepCheck($: EngineInterface, text: string, t: Triage) {
  await update($, clawdThinking, () => true)
  try {
    const r = await Promise.race([
      $.model.fork({ prompt: deepPrompt(text, t.messy ? t.clean : '', t.why) }),
      $.clock.sleep(DEEP_TIMEOUT_MS).then(() => null),
    ])
    if (!r || !r.isAnswered) return
    await bump($, { deep: 1, tokens: usedTokens(r.usage) })
    const d = parseJson<Deep>(r.text)
    if (!validDeep(d)) return
    const now = await $.clock.now()
    await raise($, { kind: 'fix', message: d.message.trim().slice(0, 200), corrected: d.corrected_prompt.trim(), at: now })
  } catch {
    // Observador nunca atrapalha: qualquer falha é silenciosa.
  } finally {
    await update($, clawdThinking, () => false)
  }
}

/** A conversa é grande e o cache esfriou? Então este envio relê tudo sem desconto. */
async function coldAndBig($: EngineInterface): Promise<number | null> {
  let last = await read($, lastReply)
  if (last === null) {
    try {
      const saved = await $.store.get(`lastReply:${await $.session.id()}`)
      if (typeof saved === 'number') last = saved
    } catch {}
  }
  if (last === null) return null
  const now = await $.clock.now()
  if (now - last < CACHE_MS) return null
  try {
    const tokens = (await $.session.usage()).context.tokens ?? 0
    return tokens >= COLD_BIG_TOKENS ? tokens : null
  } catch {
    return null
  }
}

async function sendHeld($: EngineInterface, text: string, compactFirst: boolean) {
  await update($, clawdAlert, () => null)
  if (compactFirst) {
    try {
      await $.session.compact()
      await note($, 'Conversa compactada antes de enviar.')
    } catch {}
  }
  await update($, bypassOnce, () => true)
  await $.prompt.submit({ text, asUser: true })
}

async function stopAndFix($: EngineInterface) {
  const a = await read($, clawdAlert)
  if (!a || a.kind !== 'fix') return
  const running = await read($, runningTurn)
  await update($, clawdAlert, () => null)
  if (running) {
    try {
      await $.turn.abort({ turnId: running })
    } catch {}
    await update($, bypassOnce, () => true)
    await $.prompt.submit({ text: a.corrected, asUser: true })
  } else {
    // O Claude já terminou: deixa a correção pronta na caixa de texto.
    await $.prompt.fill({ text: a.corrected })
  }
}

async function dismiss($: EngineInterface) {
  const a = await read($, clawdAlert)
  await update($, clawdAlert, () => null)
  // Conversa fria ignorada: devolve o texto à caixa para a pessoa decidir.
  if (a?.kind === 'cold') await $.prompt.fill({ text: a.held })
}

export async function openMenu($: EngineInterface) {
  await $.ui.open({ id: MENU, title: `🦀 ${NAME}`, closeOnEscape: true })
}

async function setStore($: EngineInterface, key: string, value: unknown) {
  await $.store.set(key, value)
  await $.ui.invalidate('ui.render')
}

async function compactNow($: EngineInterface) {
  try {
    const r = await $.session.compact()
    await note($, r && 'skip' in r && r.skip ? 'Compactação recusada.' : 'Conversa compactada.')
  } catch {
    await note($, 'Não deu para compactar agora (o Claude está trabalhando).')
  }
}

// ---------------------------------------------------------------------
// Ganchos (ligados pelo register.tsx, um on() por evento)
// ---------------------------------------------------------------------

export async function clawdCommand($: EngineInterface, args: string) {
  const arg = args.trim().toLowerCase()
  if (arg === 'off' || arg === 'desligar') {
    await setStore($, 'clawd:enabled', false)
    await update($, clawdAlert, () => null)
    return { text: `🦀 ${NAME} desligado. Para religar: /clawd on` }
  }
  if (arg === 'on' || arg === 'ligar') {
    await setStore($, 'clawd:enabled', true)
    return { text: `🦀 ${NAME} ligado: observando em silêncio.` }
  }
  await openMenu($)
  return { text: `🦀 Menu do ${NAME} aberto.` }
}

type Next = (e: PromptSubmitInput) => Promise<unknown>

export async function clawdSubmit($: EngineInterface, e: PromptSubmitInput, next: Next) {
  // Só prompts da pessoa; nada de comandos, metas ou do próprio Clawd.
  const kind = (e as { origin?: { kind?: string } }).origin?.kind
  const fromPerson = kind === undefined || kind === 'composer'
  if (!fromPerson || e.command || e.isMeta) return next(e)

  let t: Triage | null = null
  try {
    if (await read($, bypassOnce)) {
      await update($, bypassOnce, () => false)
      return next(e)
    }
    if (!(await clawdOn($))) return next(e)
    // Um alerta antigo perde o sentido quando chega um prompt novo.
    await update($, clawdAlert, () => null)

    // Economia grátis: conversa grande e fria → segura antes de reler tudo.
    if (await coldGuardOn($)) {
      const tokens = await coldAndBig($)
      if (tokens !== null) {
        const now = await $.clock.now()
        await bump($, { coldHolds: 1 })
        await raise($, {
          kind: 'cold',
          message: `Conversa fria e grande (~${fmtTokens(tokens)} tokens): enviar agora relê tudo sem desconto.`,
          held: e.text,
          at: now,
        })
        return { drop: `🦀 ${NAME} segurou o envio: a conversa esfriou e é grande. Escolha na linha acima do prompt.` }
      }
    }

    if (wordCount(e.text) < MIN_WORDS) return next(e)
    const mode = await getMode($)
    if (mode === 'free') return next(e)
    if (mode === 'economy' && !worthTriage(e.text).yes) {
      await bump($, { skipped: 1 })
      return next(e)
    }
    t = await triage($, e.text)
  } catch {}
  if (!t) return next(e)

  const ctx = t.messy && t.clean.trim() ? [...(e.context ?? []), cleanContext(t.clean.trim())] : e.context
  const result = await next(ctx === e.context ? e : { ...e, context: ctx })
  if (t.flag === 'check') void deepCheck($, e.text, t)
  return result
}

// ---------------------------------------------------------------------
// Desenho
// ---------------------------------------------------------------------

type Els = { Box: any; Text: any; Button: any; Svg: any }

/** O alerta ocupa a linha inteira (uma linha só) enquanto dura. */
export async function alertRow($: EngineInterface, els: Els, a: Alert, columns: number): Promise<RenderElement> {
  const { Box, Text, Button, Svg } = els
  const running = await read($, runningTurn)
  const narrow = columns < 70
  const buttons = a.kind === 'fix'
    ? [
      <Button key="clawd-fix" variant="primary" label={running ? (narrow ? 'Parar' : 'Parar e corrigir') : (narrow ? 'Corrigir' : 'Usar correção')} onPress={() => stopAndFix($)} />,
    ]
    : [
      <Button key="clawd-compact-send" variant="primary" label={narrow ? 'Compactar' : 'Compactar e enviar'} onPress={() => sendHeld($, a.held, true)} />,
      <Button key="clawd-send" plain label={narrow ? 'Enviar' : 'Enviar assim'} onPress={() => sendHeld($, a.held, false)} />,
    ]
  return (
    <Box key="clawd-alert" flexDirection="row" flexWrap="nowrap" alignItems="center" columnGap={2} paddingX={1} width="100%" overflow="hidden">
      <Box flexDirection="row" alignItems="center" columnGap={1} flexGrow={1} flexShrink={1} overflow="hidden">
        {Svg ? <Svg source={crabSvg('thinking')} alt={NAME} /> : <Text>🦀</Text>}
        <Text wrap="truncate-end">
          <Text color={CRAB} weight="semibold">{NAME} </Text>
          <Text>{a.message}</Text>
        </Text>
      </Box>
      <Box flexDirection="row" columnGap={1} flexShrink={0}>
        {buttons}
        <Button key="clawd-dismiss" plain dimColor label="Ignorar" onPress={() => dismiss($)} />
      </Box>
    </Box>
  )
}

/** O 🦀 no fim da linha da faixa: clicar abre o menu. */
export async function crabButton($: EngineInterface, els: Els): Promise<RenderElement> {
  const { Box, Text, Button, Svg } = els
  const [on_, busy] = await Promise.all([clawdOn($), read($, clawdThinking)])
  const mood: CrabMood = !on_ ? 'off' : busy ? 'thinking' : 'idle'
  const alt = !on_ ? `${NAME} desligado: abrir menu` : busy ? `${NAME} pensando: abrir menu` : `${NAME} observando: abrir menu`
  return (
    <Box key="clawd" flexDirection="row" alignItems="center" flexShrink={0}>
      {Svg ? <Svg source={crabSvg(mood)} alt={alt} /> : null}
      {Svg
        // Desenho + chevron de menu, como um avatar com lista suspensa.
        ? <Button key="clawd-crab-btn" plain dimColor label="⌄" onPress={() => openMenu($)} />
        : <Button key="clawd-crab-btn" plain dimColor={!on_} label="🦀" onPress={() => openMenu($)} />}
    </Box>
  )
}

export async function menuPane($: EngineInterface, els: Els): Promise<RenderElement> {
  const { Box, Text, Button, Svg } = els
  const [enabled, coldGuard, mode, s, entries, busy] = await Promise.all([
    clawdOn($), coldGuardOn($), getMode($), getStats($), read($, clawdLog), read($, clawdThinking),
  ])
  const modeBtn = (m: Mode, label: string) => (
    <Button key={`mode-${m}`} plain={mode !== m ? true : undefined} variant={mode === m ? 'primary' : undefined}
      label={label} onPress={() => setStore($, 'clawd:mode', m)} />
  )
  const section = (t: string) => <Text color="inactive" size="footnote" weight="semibold">{t.toUpperCase()}</Text>
  const status = enabled ? (busy ? 'Pensando…' : 'Observando em silêncio') : 'Desligado'

  return (
    <Box flexDirection="column" rowGap={1} paddingX={1}>
      <Box flexDirection="row" columnGap={1} alignItems="center">
        {Svg ? <Svg source={crabSvg(!enabled ? 'off' : busy ? 'thinking' : 'idle')} alt={NAME} /> : <Text>🦀</Text>}
        <Box flexDirection="column" flexGrow={1}>
          <Text weight="semibold">{NAME}</Text>
          <Text dimColor>{status}</Text>
        </Box>
        <Button key="toggle" variant={enabled ? undefined : 'primary'} label={enabled ? 'Desligar' : 'Ligar'}
          onPress={() => setStore($, 'clawd:enabled', !enabled)} />
      </Box>

      <Box flexDirection="column" rowGap={0}>
        {section('Modo')}
        <Box flexDirection="row" columnGap={1}>
          {modeBtn('economy', 'Economia')}
          {modeBtn('always', 'Sempre')}
          {modeBtn('free', 'Só grátis')}
        </Box>
        <Text dimColor>
          {mode === 'economy'
            ? 'Só chama o modelo quando o prompt tem cara de ditado bagunçado ou fala de algo arriscado.'
            : mode === 'always'
              ? 'Todo prompt seu com 8+ palavras passa pela triagem.'
              : 'Nunca chama modelo: só os recursos grátis.'}
        </Text>
      </Box>

      <Box flexDirection="column">
        {section('Economia de tokens')}
        <Box flexDirection="row" columnGap={2} alignItems="center">
          <Text>Segurar envio em conversa grande e fria</Text>
          <Button key="cold" plain label={coldGuard ? '● ligado' : '○ desligado'} onPress={() => setStore($, 'clawd:coldGuard', !coldGuard)} />
        </Box>
        <Box flexDirection="row">
          <Button key="compact" label="Compactar conversa agora" onPress={() => compactNow($)} />
        </Box>
      </Box>

      <Box flexDirection="column">
        {section(`Quanto o ${NAME} gastou`)}
        <Text dimColor>{`${s.triaged} triagens · ${s.skipped} puladas de graça · ${s.deep} análises profundas · ~${fmtTokens(s.tokens)} tokens`}</Text>
        <Text dimColor>{`${s.alerts} alertas · ${s.coldHolds} envios segurados em conversa fria`}</Text>
        <Box flexDirection="row">
          <Button key="reset-stats" plain dimColor label="Zerar contagem" onPress={() => setStore($, 'clawd:stats', ZERO)} />
        </Box>
      </Box>

      <Box flexDirection="column">
        {section('Últimos avisos')}
        {entries.length === 0
          ? <Text dimColor>Nenhum ainda. Silêncio é bom sinal.</Text>
          : entries.map((x, i) => <Text key={`log-${i}`} dimColor wrap="truncate-end">{`${hhmm(x.at)}  ${x.text}`}</Text>)}
      </Box>

      <Box flexDirection="column">
        {section('Em breve')}
        <Text dimColor>{`Espaço para as próximas features do ${NAME}.`}</Text>
      </Box>

      <Box flexDirection="row">
        <Button key="close" plain dimColor label="Fechar" onPress={() => $.ui.close({ id: MENU })} />
      </Box>
    </Box>
  )
}
