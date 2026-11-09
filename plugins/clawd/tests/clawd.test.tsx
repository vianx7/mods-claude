import { describe, expect, test } from 'claude-code/testing'

import { cleanContext, excerpt, parseJson, validDeep, validTriage, wordCount } from '../hooks/register'

declare const console: { log: (...a: unknown[]) => void }

const DICTATED = 'aí cara tipo faz o deletar do app lá no servidor de produção né mano'
const TRIAGE_CHECK = '{"messy":true,"clean":"Faça o deploy do app no servidor de produção.","flag":"check","why":"deletar vs deployar"}'
const TRIAGE_CLEAN = '{"messy":true,"clean":"Crie a página de login com e-mail e senha.","flag":"none","why":""}'
const TRIAGE_OK = '{"messy":false,"clean":"","flag":"none","why":""}'
const DEEP_YES = '{"intervene":true,"message":"Você disse deletar, mas a conversa toda é sobre fazer deploy.","corrected_prompt":"Faça o deploy do app no servidor de produção."}'
const DEEP_NO = '{"intervene":false,"message":"","corrected_prompt":""}'

const tick = async (n = 2000) => { for (let i = 0; i < n; i++) await Promise.resolve() }

describe('utilidades', () => {
  test('JSON dentro de texto do modelo', () => {
    expect(parseJson<{ a: number }>('Claro! {"a": 1} pronto')).toEqual({ a: 1 })
    expect(parseJson('sem json')).toBe(null)
    expect(parseJson('{quebrado')).toBe(null)
  })
  test('validação das respostas', () => {
    expect(validTriage(parseJson(TRIAGE_CHECK))).toBe(true)
    expect(validTriage(parseJson('{"messy":"sim"}'))).toBe(false)
    expect(validDeep(parseJson(DEEP_YES))).toBe(true)
    expect(validDeep(parseJson(DEEP_NO))).toBe(false)
  })
  test('contagem de palavras e trecho da conversa', () => {
    expect(wordCount('  um  dois três ')).toBe(3)
    const ex = excerpt([{ role: 'user', text: 'oi', toolUses: [] }, { role: 'assistant', text: 'olá', toolUses: [] }] as any)
    expect(ex).toBe('Pessoa: oi\n\nClaude: olá')
  })
  test('nota de contexto para o Claude', () => {
    expect(cleanContext('X').includes('ditado por voz')).toBe(true)
  })
})

const setup = (on: any, triage: string, deep: string, calls: { fork: number; complete: number; seen: any }) => {
  on('model.complete', () => { calls.complete++; return { value: { isAnswered: true, text: triage, usage: {} } } })
  on('model.fork', () => { calls.fork++; return { value: { isAnswered: true, text: deep, usage: {} } } })
  on('session.messages', () => ({ value: [] }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 1_000 }))
  on('clock.sleep', () => new Promise(() => {}))
  on('ui.notify', () => ({ value: { isSent: true, channel: 'terminal' } }))
  on('prompt.submit', (_: any, e: any) => { calls.seen = e; return { text: e.text } })
  // Representa o desenho do motor (ou de outro plugin) embaixo do Clawd.
  on('ui.render', ($: any, e: any) => { const { Text } = $.ui.resolve(e); return <Text>faixa de baixo</Text> })
}

test('prompt confuso: anexa a interpretação limpa, sem mudar o texto', async ($, on) => {
  const calls = { fork: 0, complete: 0, seen: null as any }
  setup(on, TRIAGE_CLEAN, DEEP_NO, calls)
  await $.prompt.submit({ text: 'tipo cria aí a página de login né com email e senha e tal cara' } as any)
  expect(calls.seen.text).toBe('tipo cria aí a página de login né com email e senha e tal cara')
  expect(calls.seen.context?.[0]?.includes('Crie a página de login')).toBe(true)
  expect(calls.fork).toBe(0) // nada crucial: sem análise profunda
})

test('prompt limpo: não anexa nada', async ($, on) => {
  const calls = { fork: 0, complete: 0, seen: null as any }
  setup(on, TRIAGE_OK, DEEP_NO, calls)
  await $.prompt.submit({ text: 'Crie a página de login com e-mail e senha usando o componente existente.' } as any)
  expect(calls.seen.context).toBe(undefined)
  expect(calls.fork).toBe(0)
})

test('prompt curto: nem faz triagem', async ($, on) => {
  const calls = { fork: 0, complete: 0, seen: null as any }
  setup(on, TRIAGE_CHECK, DEEP_YES, calls)
  await $.prompt.submit({ text: 'roda os testes' } as any)
  expect(calls.complete).toBe(0)
})

test('suspeita crucial: análise profunda e alerta na faixa', async ($, on) => {
  const calls = { fork: 0, complete: 0, seen: null as any }
  setup(on, TRIAGE_CHECK, DEEP_YES, calls)
  await $.prompt.submit({ text: DICTATED } as any)
  await tick()
  expect(calls.fork).toBe(1)
  const ui = await $.ui.mount({
    plugin: 'clawd', component: 'AbovePrompt', surface: 'desktop',
    props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100 } as any,
  } as any)
  const tree: any = await ui.drawn()
  console.log('alerta:', JSON.stringify(tree).slice(0, 400))
  expect(tree.props.key).toBe('clawd-alert')
  expect(JSON.stringify(tree).includes('Você disse deletar')).toBe(true)
  expect(await ui.find({ type: 'Button', key: 'clawd-fix' })).toBeTruthy()
  await ui.unmount()
})

test('suspeita descartada pela análise profunda: fica invisível', async ($, on) => {
  const calls = { fork: 0, complete: 0, seen: null as any }
  setup(on, TRIAGE_CHECK, DEEP_NO, calls)
  await $.prompt.submit({ text: DICTATED } as any)
  await tick()
  expect(calls.fork).toBe(1)
  const ui = await $.ui.mount({
    plugin: 'clawd', component: 'AbovePrompt', surface: 'desktop',
    props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100 } as any,
  } as any)
  const tree: any = await ui.drawn()
  expect(JSON.stringify(tree).includes('clawd-alert')).toBe(false)
  expect(JSON.stringify(tree).includes('faixa de baixo')).toBe(true)
  await ui.unmount()
})

test('triagem falhou: o prompt segue intacto', async ($, on) => {
  const calls = { fork: 0, complete: 0, seen: null as any }
  setup(on, 'resposta sem json', DEEP_YES, calls)
  await $.prompt.submit({ text: DICTATED } as any)
  expect(calls.seen.text).toBe(DICTATED)
  expect(calls.seen.context).toBe(undefined)
  expect(calls.fork).toBe(0)
})

test('botão com o Claude parado: deixa a correção na caixa de texto', async ($, on) => {
  const calls = { fork: 0, complete: 0, seen: null as any }
  let filled = ''
  setup(on, TRIAGE_CHECK, DEEP_YES, calls)
  on('prompt.fill', (_: any, e: any) => { filled = e.text; return { isFilled: true } })
  await $.prompt.submit({ text: DICTATED } as any)
  await tick()
  const ui = await $.ui.mount({
    plugin: 'clawd', component: 'AbovePrompt', surface: 'terminal',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 } as any,
  } as any)
  const b: any = await ui.find({ type: 'Button', key: 'clawd-fix' })
  expect(b.props.label).toBe('Usar correção')
  await ui.press({ key: 'clawd-fix' })
  await tick()
  expect(filled).toBe('Faça o deploy do app no servidor de produção.')
  // Depois de usar, o alerta some e a faixa volta para quem está embaixo.
  expect(JSON.stringify(await ui.drawn()).includes('clawd-alert')).toBe(false)
  await ui.unmount()
})
