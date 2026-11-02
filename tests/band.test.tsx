import { describe, expect, test } from 'claude-code/testing'

import { classifyPace, fmtShort, freshness, needed, paceRatio, pickTier, temperature, usageText, dotSvg, barSvg } from '../hooks/register'

declare const console: { log: (...a: unknown[]) => void }

const NOW = Date.parse('2026-11-01T12:00:00Z')
const H = 3_600_000
const FIVE = { percentUsed: 94, resetsAt: new Date(NOW + 106 * 60_000).toISOString() }
const WEEK = { percentUsed: 20, resetsAt: new Date(NOW + (3 * 24 + 5) * H).toISOString() }

describe('unidades', () => {
  test('tempos curtos e longos', () => {
    expect(fmtShort(59)).toBe('59m')
    expect(fmtShort(106)).toBe('1h46')
    expect(fmtShort(30 * 60)).toBe('1d6h')
    expect(fmtShort(77 * 60)).toBe('3d')
  })
  test('texto do bloco: 5 h e semana no mesmo formato', () => {
    expect(usageText('five', FIVE, NOW, 'wide')).toEqual({ label: '5h', pct: '94%', renew: 'renova em 1h46' })
    expect(usageText('week', WEEK, NOW, 'wide')).toEqual({ label: 'Semana', pct: '20%', renew: 'renova em 3d' })
    expect(usageText('week', WEEK, NOW, 'narrow')).toEqual({ label: '7d', pct: '20%', renew: '3d' })
  })
  test('sem dados: "—", nunca 0%', () => {
    expect(usageText('five', null, NOW, 'wide').pct).toBe('—')
  })
  test('ritmo com histerese e "calculando" sem histórico', () => {
    expect(classifyPace('normal', null)).toBe('calculating')
    expect(classifyPace('normal', 0.95)).toBe('elevated')
    expect(classifyPace('elevated', 0.85)).toBe('elevated')
    expect(classifyPace('elevated', 0.79)).toBe('normal')
    expect(classifyPace('normal', 1.3)).toBe('high')
    expect(Math.round((paceRatio(FIVE, NOW) ?? 0) * 100)).toBe(145)
  })
  test('cache: quente, morno, frio, novo, desconhecido', () => {
    expect(temperature(NOW - 10 * 60_000, true, NOW).kind).toBe('hot')
    expect(temperature(NOW - 50 * 60_000, true, NOW).kind).toBe('warm')
    expect(temperature(NOW - 2 * H, true, NOW).kind).toBe('cold')
    expect(temperature(null, false, NOW).kind).toBe('new')
    expect(temperature(null, true, NOW).kind).toBe('unknown')
  })
  test('desatualizado só quando a renovação passou sem leitura', () => {
    const after = Date.parse(FIVE.resetsAt) + 60_000
    expect(freshness(FIVE, NOW - 3 * H, null, false, NOW)).toBe('ok')
    expect(freshness(FIVE, NOW, null, false, after)).toBe('stale')
    expect(freshness(FIVE, NOW, null, true, after)).toBe('updating')
    expect(freshness(FIVE, NOW, { at: after, reason: 'x' }, false, after + 1)).toBe('failed')
  })
  test('movimento reduzido', () => {
    expect(barSvg({ from: 10, to: 60, at: 0 }, 12).includes('prefers-reduced-motion')).toBe(true)
    expect(dotSvg(temperature(NOW, true, NOW), true).includes('prefers-reduced-motion')).toBe(true)
  })
  test('níveis pela largura da faixa', () => {
    console.log('colunas necessárias:', needed('wide'), needed('medium'), needed('narrow'))
    expect(pickTier(200)).toBe('wide')
    expect(pickTier(needed('wide') - 1)).toBe('medium')
    expect(pickTier(needed('medium') - 1)).toBe('narrow')
    expect(needed('narrow')).toBeLessThan(30)
  })
})

// ------------------------------------------------------------------

type Scenario = { surface?: 'terminal' | 'desktop'; columns: number; view?: 'five' | 'week'; working?: boolean; five?: unknown; week?: unknown; lastMin?: number | null; pace?: string }

const mount = async ($: any, on: any, s: Scenario) => {
  on('clock.now', () => ({ value: NOW }))
  const values: Record<string, unknown> = {
    usage: { five: s.five === undefined ? FIVE : s.five, week: s.week === undefined ? WEEK : s.week },
    hasContext: true,
    lastReply: s.lastMin === undefined ? NOW - 10 * 60_000 : s.lastMin === null ? null : NOW - s.lastMin * 60_000,
    lastMeasure: NOW - 2 * 60_000,
    failure: null,
    tick: 0,
    fill: { from: 94, to: 94, at: 0 },
    pulse: false,
    pace: { level: s.pace ?? 'elevated', window: FIVE.resetsAt },
    view: s.view ?? 'five',
  }
  on('state.get', (_: any, e: any) => ({ value: { value: values[e.key], version: 1 } }))
  return $.ui.mount({
    plugin: 'usage-band', component: 'AbovePrompt', surface: s.surface ?? 'terminal',
    props: { hasSurvey: false, isWorking: !!s.working, maxRows: 10, bodyColumns: s.columns } as any,
  } as any)
}

const visible = (n: any): string => {
  if (typeof n === 'string') return n
  if (!n || typeof n !== 'object') return ''
  if (n.type === 'Svg') return `[${n.props.alt}]`
  const kids = (n.children ?? []).map(visible)
  if (n.type === 'Button') return kids.join('') || (n.props?.label ?? '')
  return n.type === 'Box' && n.props?.flexDirection === 'row' ? kids.filter(Boolean).join(' ') : kids.join('')
}

const SHOTS: [string, Scenario][] = [
  ['larga-5h', { columns: 100 }],
  ['larga-semana', { columns: 100, view: 'week' }],
  ['macbook-5h', { columns: 85 }],
  ['macbook-semana', { columns: 85, view: 'week' }],
  ['media-5h', { columns: 60 }],
  ['estreita-5h', { columns: 40 }],
  ['estreita-semana', { columns: 40, view: 'week' }],
  ['sem-dados', { columns: 85, five: null, week: null, lastMin: null }],
  ['frio-ritmo-alto', { columns: 85, lastMin: 180, pace: 'high' }],
  ['morno-trabalhando', { columns: 85, lastMin: 50, working: true, pace: 'normal' }],
]

for (const surface of ['terminal', 'desktop'] as const) {
  for (const [name, sc] of SHOTS) {
    test(`${surface} ${name}: uma linha`, async ($, on) => {
      const ui = await mount($, on, { ...sc, surface })
      const tree = await ui.drawn()
      console.log(`TREE::${surface}-${name}::${sc.columns}::${JSON.stringify(tree)}`)
      console.log(`${surface} ${name} (${sc.columns}): ${visible(tree)}`)
      expect(tree.props.flexDirection).toBe('row')
      expect(tree.props.flexWrap).toBe('nowrap')
      await ui.unmount()
    })
  }
}

test('5 h: barra, %, ritmo e renovação no mesmo botão', async ($, on) => {
  const ui = await mount($, on, { columns: 100 })
  const b: any = await ui.find({ type: 'Button', key: 'usage' })
  expect(visible(b)).toBe('5h 94% ↗ · renova em 1h46')
  expect(visible(await ui.drawn()).includes('Quente')).toBe(true)
  await ui.unmount()
})

test('semana: mesmo bloco, sem ritmo', async ($, on) => {
  const ui = await mount($, on, { columns: 100, view: 'week' })
  const b: any = await ui.find({ type: 'Button', key: 'usage' })
  expect(visible(b)).toBe('Semana 20% · renova em 3d')
  await ui.unmount()
})

test('estreita: sem barra, rótulos curtos, só o símbolo do cache', async ($, on) => {
  const ui = await mount($, on, { columns: 40, view: 'week' })
  const line = visible(await ui.drawn())
  expect(line.includes('━')).toBe(false)
  expect(line.includes('7d 20%  3d')).toBe(true)
  expect(line.includes('Quente')).toBe(false)
  await ui.unmount()
})

test('só há um botão: o bloco de uso', async ($, on) => {
  const ui = await mount($, on, { columns: 100 })
  expect((await ui.findAll({ type: 'Button' })).map((b: any) => b.key)).toEqual(['usage'])
  await ui.unmount()
})

test('trocar de visão não muda o resto da linha', async ($, on) => {
  const a = await mount($, on, { columns: 85 })
  const cacheA = visible((await a.drawn()).children[1])
  await a.unmount()
  expect(cacheA).toBe('◉ Quente')
})
