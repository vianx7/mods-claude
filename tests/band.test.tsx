import { expect, test } from 'claude-code/testing'

test('a faixa mostra 5h, renovação e semana', async ($, on) => {
  const now = Date.parse('2026-11-01T12:00:00Z')
  on('clock.now', () => ({ value: now }))
  on('state.get', (_, e: any) => ({
    value: e.key === 'usage'
      ? { value: { five: { percentUsed: 34, resetsAt: '2026-11-01T14:17:00Z' }, week: { percentUsed: 12 } }, version: 1 }
      : { value: 0, version: 1 },
  }))
  const ui = await $.ui.mount({
    plugin: 'usage-band', component: 'AbovePrompt', surface: 'terminal',
    props: { hasSurvey: false, isWorking: false, maxRows: 10 } as any,
  } as any)
  const texts = await ui.findAll({ type: 'Text' })
  console.log(JSON.stringify(texts.map((t: any) => t.text)))
  expect((await ui.find({ type: 'Text', text: /Renova em 2 h 17 min/ })) != null).toBe(true)
  await ui.unmount()
})
