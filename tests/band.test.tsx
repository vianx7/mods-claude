import { expect, test } from 'claude-code/testing'

const NOW = Date.parse('2026-11-01T12:00:00Z')

const mount = async ($: any, on: any, opts: { lastMin?: number | null; columns?: number; surface?: string; working?: boolean; slot?: number } = {}) => {
  const { lastMin = 10, columns = 140, surface = 'terminal', working = false, slot = 0 } = opts
  on('clock.now', () => ({ value: NOW }))
  const values: Record<string, unknown> = {
    // 3 h passadas da janela com 70% usados: ritmo acima do limite
    usage: { five: { percentUsed: 70, resetsAt: '2026-11-01T14:00:00Z' }, week: { percentUsed: 12, resetsAt: '2026-11-06T09:00:00Z' } },
    hasContext: true,
    lastReply: lastMin === null ? null : NOW - lastMin * 60_000,
    tick: 0,
    fill: { from: 70, to: 70, at: 0 },
    pulse: false,
    slot,
  }
  on('state.get', (_: any, e: any) => ({ value: { value: values[e.key], version: 1 } }))
  return $.ui.mount({
    plugin: 'usage-band', component: 'AbovePrompt', surface,
    props: { hasSurvey: false, isWorking: working, maxRows: 10, bodyColumns: columns } as any,
  } as any)
}

const texts = async (ui: any) => (await ui.findAll({ type: 'Text' })).map((t: any) => t.text)

test('terminal: uma linha com ritmo e temperatura', async ($, on) => {
  const ui = await mount($, on)
  const t = await texts(ui)
  console.log('terminal:', t.join(' | '))
  expect(t.some((x: string) => x.includes('━'))).toBe(true)
  expect(t.includes('●')).toBe(true)
  expect(t.includes('Quente')).toBe(true)
  expect(t.includes('↗')).toBe(true)
  expect(await ui.find({ type: 'Button', key: 'slot' })).toBeTruthy()
  await ui.unmount()
})

test('morno e frio', async ($, on) => {
  let ui = await mount($, on, { lastMin: 50 })
  expect((await texts(ui)).includes('Morno')).toBe(true)
  await ui.unmount()
})

test('frio depois de dias', async ($, on) => {
  const ui = await mount($, on, { lastMin: 3 * 24 * 60 })
  expect((await texts(ui)).includes('Frio')).toBe(true)
  await ui.unmount()
})

test('desktop: barra e bolinha em SVG, pulsando enquanto trabalha', async ($, on) => {
  const ui = await mount($, on, { surface: 'desktop', working: true, columns: 80 })
  const svgs = await ui.findAll({ type: 'Svg' })
  expect(svgs.length).toBe(2)
  const dot = svgs.find((s: any) => /circle/.test(s.props.source))
  expect(/repeatCount="indefinite"/.test(dot.props.source)).toBe(true)
  await ui.unmount()
})

const expected = ['Renova em 2 h', 'Renova às', 'Acaba em ~', 'Semana renova']
for (const [i, prefix] of expected.entries()) {
  test(`toque ${i}: ${prefix}`, async ($, on) => {
    const ui = await mount($, on, { slot: i })
    const b: any = await ui.find({ type: 'Button', key: 'slot' })
    console.log(`slot ${i}:`, b.text)
    expect(b.text.startsWith(prefix)).toBe(true)
    await ui.unmount()
  })
}
