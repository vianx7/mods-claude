import { expect, test } from 'claude-code/testing'

const NOW = Date.parse('2026-11-01T12:00:00Z')

const render = async ($: any, on: any, lastReplyMinAgo: number | null, columns = 140, surface = 'terminal') => {
  on('clock.now', () => ({ value: NOW }))
  const values: Record<string, unknown> = {
    usage: { five: { percentUsed: 34, resetsAt: '2026-11-01T14:17:00Z' }, week: { percentUsed: 12 } },
    hasContext: true,
    lastReply: lastReplyMinAgo === null ? null : NOW - lastReplyMinAgo * 60_000,
    tick: 0,
  }
  on('state.get', (_: any, e: any) => ({ value: { value: values[e.key], version: 1 } }))
  const ui = await $.ui.mount({
    plugin: 'usage-band', component: 'AbovePrompt', surface,
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: columns } as any,
  } as any)
  const texts = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text)
  await ui.unmount()
  return texts
}

test('quente', async ($, on) => {
  const t = await render($, on, 10)
  console.log(t.filter((x: string) => x.length > 6).join(' | '))
  expect(t.some((x: string) => x === 'Quente')).toBe(true)
  expect(t.some((x: string) => /Contexto/.test(x))).toBe(false)
})

test('morno', async ($, on) => {
  const t = await render($, on, 50)
  expect(t.some((x: string) => x === 'Morno')).toBe(true)
})

test('frio depois de dias', async ($, on) => {
  const t = await render($, on, 3 * 24 * 60)
  expect(t.some((x: string) => x === 'Frio')).toBe(true)
})

test('desktop estreito continua em uma linha', async ($, on) => {
  const t = await render($, on, 10, 60, 'desktop')
  console.log(t.filter((x: string) => x.length > 4).join(' | '))
  expect(t.some((x: string) => /↻ 2 h 17 min/.test(x))).toBe(true)
})
