import { describe, expect, test } from 'claude-code/testing'

import { cleanContext, excerpt, fmtTokens, parseJson, validDeep, validTriage, wordCount, worthTriage } from '../hooks/register'

declare const console: { log: (...a: unknown[]) => void }

const DICTATED = 'aí cara tipo faz o deletar do app lá no servidor de produção né mano'
const DICTATED_SAFE = 'tipo cria aí a página de login né com email e senha e tal cara'
const CLEAN = 'Crie a página de login com e-mail e senha usando o componente existente.'
const TRIAGE_CHECK = '{"messy":true,"clean":"Faça o deploy do app no servidor de produção.","flag":"check","why":"deletar vs deployar"}'
const TRIAGE_CLEAN = '{"messy":true,"clean":"Crie a página de login com e-mail e senha.","flag":"none","why":""}'
const TRIAGE_OK = '{"messy":false,"clean":"","flag":"none","why":""}'
const DEEP_YES = '{"intervene":true,"message":"Você disse deletar, mas a conversa toda é sobre fazer deploy.","corrected_prompt":"Faça o deploy do app no servidor de produção."}'
const DEEP_NO = '{"intervene":false,"message":"","corrected_prompt":""}'

const NOW = 10 * 3_600_000
const tick = async (n = 2000) => { for (let i = 0; i < n; i++) await Promise.resolve() }

describe('utilidades', () => {
  test('JSON dentro de texto do modelo', () => {
    expect(parseJson<{ a: number }>('Claro! {"a": 1} pronto')).toEqual({ a: 1 })
    expect(parseJson('sem json')).toBe(null)
  })
  test('validação das respostas', () => {
    expect(validTriage(parseJson(TRIAGE_CHECK))).toBe(true)
    expect(validTriage(parseJson('{"messy":"sim"}'))).toBe(false)
    expect(validDeep(parseJson(DEEP_YES))).toBe(true)
    expect(validDeep(parseJson(DEEP_NO))).toBe(false)
  })
  test('trecho curto da conversa (economia)', () => {
    const msgs = [1, 2, 3, 4, 5].map(i => ({ role: i % 2 ? 'user' : 'assistant', text: 'x'.repeat(1000) + i, toolUses: [] }))
    const ex = excerpt(msgs as any)
    expect(ex.split('\n\n').length).toBe(3)
    expect(ex.length).toBeLessThan(1300)
    expect(wordCount('  um  dois três ')).toBe(3)
    expect(cleanContext('X').includes('ditado por voz')).toBe(true)
    expect(fmtTokens(84_321)).toBe('84k')
  })
})

describe('pré-filtro grátis', () => {
  test('ditado bagunçado passa para a triagem', () => {
    expect(worthTriage(DICTATED_SAFE)).toEqual({ yes: true, why: 'messy' })
  })
  test('algo arriscado sempre passa', () => {
    expect(worthTriage('Por favor apague a tabela de usuários antiga.').why).toBe('risky')
    expect(worthTriage('faz o deploy em produção').why).toBe('risky')
  })
  test('prompt limpo é pulado de graça', () => {
    expect(worthTriage(CLEAN)).toEqual({ yes: false, why: 'clean' })
    expect(worthTriage('Adicione um botão azul no cabeçalho, alinhado à direita, com o texto Sair.').yes).toBe(false)
  })
  test('ditado longo sem pontuação passa', () => {
    const t = 'quero que você adicione um botão no cabeçalho que leva para a página de perfil do usuário com a foto dele e o nome embaixo também'
    expect(worthTriage(t).yes).toBe(true)
  })
})

// ------------------------------------------------------------------

type Opts = { triage?: string; deep?: string; store?: Record<string, unknown>; ctxTokens?: number; beneath?: 'text' | 'usage' }
type Calls = { fork: number; complete: number; seen: any; filled: string; submitted: string[]; compacted: number; opened: string }

const setup = (on: any, o: Opts = {}): Calls => {
  const calls: Calls = { fork: 0, complete: 0, seen: null, filled: '', submitted: [], compacted: 0, opened: '' }
  const store: Record<string, unknown> = { ...(o.store ?? {}) }
  on('model.complete', () => { calls.complete++; return { value: { isAnswered: true, text: o.triage ?? TRIAGE_OK, usage: { input_tokens: 900, output_tokens: 80 } } } })
  on('model.fork', () => { calls.fork++; return { value: { isAnswered: true, text: o.deep ?? DEEP_NO, usage: { input_tokens: 100, output_tokens: 120 } } } })
  on('session.messages', () => ({ value: [] }))
  on('session.id', () => ({ value: 's1' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000, tokens: o.ctxTokens ?? 5_000, percent: 3 }, rateLimits: [] } }))
  on('session.compact', () => { calls.compacted++; return { skip: 'teste' } })
  on('store.get', (_: any, e: any) => ({ value: store[e.key] }))
  on('store.set', (_: any, e: any) => { store[e.key] = e.value; return { value: undefined } })
  on('clock.now', () => ({ value: NOW }))
  on('clock.sleep', () => new Promise(() => {}))
  on('ui.notify', () => ({ value: { isSent: true, channel: 'terminal' } }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.open', (_: any, e: any) => { calls.opened = e.id; return { value: { isPlaced: true } } })
  on('prompt.fill', (_: any, e: any) => { calls.filled = e.text; return { isFilled: true } })
  on('prompt.submit', (_: any, e: any) => { calls.seen = e; calls.submitted.push(e.text); return { text: e.text } })
  on('ui.render', ($: any, e: any) => {
    const { Box, Text } = $.ui.resolve(e)
    return o.beneath === 'usage'
      ? <Box key="usage-band-row" flexDirection="row"><Text>5h 94%</Text><Text>◉</Text></Box>
      : <Text>faixa de baixo</Text>
  })
  return calls
}

const band = ($: any, surface: 'terminal' | 'desktop' = 'desktop', isWorking = true) =>
  $.ui.mount({ plugin: 'clawd', component: 'AbovePrompt', surface, props: { hasSurvey: false, isWorking, maxRows: 10, bodyColumns: 100 } } as any)

test('economia: prompt limpo não gasta nada', async ($, on) => {
  const c = setup(on)
  await $.prompt.submit({ text: CLEAN } as any)
  expect(c.complete).toBe(0)
  expect(c.seen.context).toBe(undefined)
})

test('economia: ditado confuso anexa a interpretação limpa, sem mudar o texto', async ($, on) => {
  const c = setup(on, { triage: TRIAGE_CLEAN })
  await $.prompt.submit({ text: DICTATED_SAFE } as any)
  expect(c.complete).toBe(1)
  expect(c.seen.text).toBe(DICTATED_SAFE)
  expect(c.seen.context?.[0]?.includes('Crie a página de login')).toBe(true)
  expect(c.fork).toBe(0)
})

test('modo "sempre": até prompt limpo passa pela triagem', async ($, on) => {
  const c = setup(on, { store: { mode: 'always' } })
  await $.prompt.submit({ text: CLEAN } as any)
  expect(c.complete).toBe(1)
})

test('modo "só grátis": nunca chama modelo', async ($, on) => {
  const c = setup(on, { triage: TRIAGE_CHECK, store: { mode: 'free' } })
  await $.prompt.submit({ text: DICTATED } as any)
  expect(c.complete).toBe(0)
  expect(c.fork).toBe(0)
})

test('desligado: não faz nada', async ($, on) => {
  const c = setup(on, { triage: TRIAGE_CHECK, store: { enabled: false } })
  await $.prompt.submit({ text: DICTATED } as any)
  expect(c.complete).toBe(0)
})

test('suspeita crucial: análise profunda e alerta na faixa', async ($, on) => {
  const c = setup(on, { triage: TRIAGE_CHECK, deep: DEEP_YES })
  await $.prompt.submit({ text: DICTATED } as any)
  await tick()
  expect(c.fork).toBe(1)
  const ui = await band($)
  const tree: any = await ui.drawn()
  expect(tree.props.key).toBe('clawd-alert')
  expect(JSON.stringify(tree).includes('Você disse deletar')).toBe(true)
  await ui.unmount()
})

test('suspeita descartada: fica quieto e só mostra o 🦀', async ($, on) => {
  const c = setup(on, { triage: TRIAGE_CHECK, deep: DEEP_NO })
  await $.prompt.submit({ text: DICTATED } as any)
  await tick()
  expect(c.fork).toBe(1)
  const ui = await band($)
  const tree: any = await ui.drawn()
  expect(tree.props.key).toBe('clawd-crab')
  await ui.unmount()
})

test('botão com o Claude parado: deixa a correção na caixa de texto', async ($, on) => {
  const c = setup(on, { triage: TRIAGE_CHECK, deep: DEEP_YES })
  await $.prompt.submit({ text: DICTATED } as any)
  await tick()
  const ui = await band($, 'terminal', false)
  expect(((await ui.find({ type: 'Button', key: 'clawd-fix' })) as any).props.label).toBe('Usar correção')
  await ui.press({ key: 'clawd-fix' })
  await tick()
  expect(c.filled).toBe('Faça o deploy do app no servidor de produção.')
  expect(JSON.stringify(await ui.drawn()).includes('clawd-alert')).toBe(false)
  await ui.unmount()
})

// ------------------------------------------------------------------
// Conversa grande e fria
// ------------------------------------------------------------------

const coldStore = { 'lastReply:s1': NOW - 3 * 3_600_000 }

test('conversa grande e fria: segura o envio e oferece compactar', async ($, on) => {
  const c = setup(on, { store: coldStore, ctxTokens: 120_000 })
  await $.prompt.submit({ text: CLEAN } as any).catch(() => {})
  expect(c.submitted.length).toBe(0) // não chegou ao Claude
  const ui = await band($)
  const s = JSON.stringify(await ui.drawn())
  console.log('fria:', s.slice(0, 300))
  expect(s.includes('~120k tokens')).toBe(true)
  expect(await ui.find({ type: 'Button', key: 'clawd-compact-send' })).toBeTruthy()
  await ui.press({ key: 'clawd-compact-send' })
  await tick()
  expect(c.compacted).toBe(1)
  expect(c.submitted).toEqual([CLEAN]) // reenviado uma vez, sem ser segurado de novo
  await ui.unmount()
})

test('conversa fria: "Enviar assim" manda sem compactar', async ($, on) => {
  const c = setup(on, { store: coldStore, ctxTokens: 120_000 })
  await $.prompt.submit({ text: CLEAN } as any).catch(() => {})
  const ui = await band($)
  await ui.press({ key: 'clawd-send' })
  await tick()
  expect(c.compacted).toBe(0)
  expect(c.submitted).toEqual([CLEAN])
  await ui.unmount()
})

test('conversa fria mas pequena: não segura', async ($, on) => {
  const c = setup(on, { store: coldStore, ctxTokens: 8_000 })
  await $.prompt.submit({ text: CLEAN } as any)
  expect(c.submitted).toEqual([CLEAN])
})

test('aviso de conversa fria desligado no menu: não segura', async ($, on) => {
  const c = setup(on, { store: { ...coldStore, coldGuard: false }, ctxTokens: 120_000 })
  await $.prompt.submit({ text: CLEAN } as any)
  expect(c.submitted).toEqual([CLEAN])
})

// ------------------------------------------------------------------
// 🦀 e menu
// ------------------------------------------------------------------

test('o 🦀 entra no fim da linha da faixa de uso', async ($, on) => {
  setup(on, { beneath: 'usage' })
  const ui = await band($)
  const tree: any = await ui.drawn()
  expect(tree.props.key).toBe('usage-band-row+clawd')
  expect(JSON.stringify(tree.children.at(-1)).includes('clawd-crab-btn')).toBe(true)
  expect(JSON.stringify(tree).includes('5h 94%')).toBe(true)
  await ui.unmount()
})

test('clicar no 🦀 abre o menu', async ($, on) => {
  const c = setup(on)
  const ui = await band($)
  await ui.press({ key: 'clawd-crab-btn' })
  expect(c.opened).toBe('clawd-menu')
  await ui.unmount()
})

test('menu mostra modo, economia, gastos e avisos', async ($, on) => {
  setup(on, { store: { stats: { triaged: 12, skipped: 30, deep: 2, alerts: 1, coldHolds: 1, tokens: 15_400 } } })
  const ui = await $.ui.mount({
    plugin: 'clawd', component: 'Pane', requestId: 'clawd-menu', surface: 'desktop',
    props: { title: '🦀 Clawd', isFocused: false, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  } as any)
  const s = JSON.stringify(await ui.drawn())
  for (const t of ['Observando', 'Economia', 'Sempre', 'Só grátis', 'Compactar conversa agora', '12 triagens', '30 puladas de graça', '~15k tokens', 'Em breve']) {
    expect(s.includes(t)).toBe(true)
  }
  const keys = (await ui.findAll({ type: 'Button' })).map((b: any) => b.key)
  console.log('menu:', keys.join(', '))
  expect(keys.includes('toggle')).toBe(true)
  await ui.unmount()
})
