import { expect, test } from 'claude-code/testing'

const NOW = Date.parse('2026-11-01T12:00:00Z')

const render = async ($: any, on: any, lastReplyMinAgo: number | null, columns = 140) => {
  on('clock.now', () => ({ value: NOW }))
  const values: Record<string, unknown> = {
    usage: { five: { percentUsed: 34, resetsAt: '2026-11-01T14:17:00Z' }, week: { percentUsed: 12 } },
    ctx: { percent: 42, tokens: 84000 },
    lastReply: lastReplyMinAgo === null ? null : NOW - lastReplyMinAgo * 60_000,
    tick: 0,
  }
  on('state.get', (_: any, e: any) => ({ value: { value: values[e.key], version: 1 } }))
  const ui = await $.ui.mount({
    plugin: 'usage-band', component: 'AbovePrompt', surface: 'terminal',
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
  expect(t.some((x: string) => /esfria em 50 min/.test(x))).toBe(true)
})

test('morno', async ($, on) => {
  const t = await render($, on, 50)
  expect(t.some((x: string) => x === 'Morno')).toBe(true)
})

test('frio depois de dias', async ($, on) => {
  const t = await render($, on, 3 * 24 * 60)
  expect(t.some((x: string) => x === 'Frio')).toBe(true)
  expect(t.some((x: string) => /há 3 d/.test(x))).toBe(true)
})
