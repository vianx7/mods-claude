import { describe, expect, test } from 'claude-code/testing'

import {
  classifyPace, fmtShort, freshness, needed, paceRatio, pickTier, ringSvg, dotSvg, barSvg,
  slotLabels, temperature,
} from '../hooks/register'

declare const console: { log: (...a: unknown[]) => void }

const NOW = Date.parse('2026-11-01T12:00:00Z')
const H = 3_600_000

// Janela de 5 h que renova em 1h46 (3h14 já passadas).
const FIVE = { percentUsed: 94, resetsAt: new Date(NOW + 106 * 60_000).toISOString() }
const WEEK = { percentUsed: 20, resetsAt: new Date(NOW + (3 * 24 + 5) * H).toISOString() }

const baseModel = (over: Record<string, unknown> = {}) => ({
  now: NOW, five: FIVE, ctx: 62, paceLevel: 'elevated', slotIdx: 0,
  temp: temperature(NOW - 10 * 60_000, true, NOW), fiveFresh: 'ok', ...over,
}) as any

// ------------------------------------------------------------------
// Unidades puras
// ------------------------------------------------------------------

describe('tempos', () => {
  test('curtos e longos', () => {
    expect(fmtShort(0)).toBe('0m')
    expect(fmtShort(59)).toBe('59m')
    expect(fmtShort(60)).toBe('1h00')
    expect(fmtShort(106)).toBe('1h46')
    expect(fmtShort(23 * 60 + 5)).toBe('23h05')
    expect(fmtShort(30 * 60)).toBe('1d6h')
    expect(fmtShort(77 * 60)).toBe('3d')
  })
})

describe('ritmo: três estados com histerese', () => {
  test('sem histórico suficiente é "calculando", nunca "normal"', () => {
    const early = { percentUsed: 3, resetsAt: new Date(NOW + 4.8 * H).toISOString() }
    expect(paceRatio(early, NOW)).toBe(null)
    expect(classifyPace('normal', null)).toBe('calculating')
  })
  test('limiares de subida', () => {
    expect(classifyPace('calculating', 0.5)).toBe('normal')
    expect(classifyPace('normal', 0.9)).toBe('elevated')
    expect(classifyPace('normal', 1.25)).toBe('high')
  })
  test('pequenas oscilações não derrubam o estado', () => {
    expect(classifyPace('elevated', 0.85)).toBe('elevated') // dentro da margem
    expect(classifyPace('elevated', 0.79)).toBe('normal')
    expect(classifyPace('high', 1.2)).toBe('high')
    expect(classifyPace('high', 1.1)).toBe('elevated')
    expect(classifyPace('high', 0.7)).toBe('normal')
  })
  test('R usa a fração da janela já passada', () => {
    // 94% em 3h14 de 5h: R ≈ 1,45
    expect(Math.round((paceRatio(FIVE, NOW) ?? 0) * 100)).toBe(145)
  })
})

describe('renovação', () => {
  test('as duas opções do botão das 5 h, longas e curtas', () => {
    const m = baseModel()
    const wide = slotLabels(m, 'wide')
    const narrow = slotLabels(m, 'narrow')
    console.log('slot wide:', wide.join(' | '), ' / curto:', narrow.join(' | '))
    expect(wide.length).toBe(2)
    expect(wide[0]).toBe('Renova em 1h46')
    expect(wide[1]!.startsWith('Renova às ')).toBe(true)
    expect(narrow[0]).toBe('1h46')
    expect(/^\d\d:\d\d$/.test(narrow[1]!)).toBe(true)
  })
  test('chegar a zero mostra "renovou", sem inventar consumo', () => {
    const m = baseModel({ now: Date.parse(FIVE.resetsAt) + 60_000 })
    expect(slotLabels(m, 'wide')[0]).toBe('Renovou')
    expect(freshness(FIVE, NOW, null, false, m.now)).toBe('stale')
  })
})

describe('dados desatualizados ou indisponíveis', () => {
  const afterReset = Date.parse(FIVE.resetsAt) + 5 * 60_000
  test('ocioso com janela válida: nada a avisar', () => {
    expect(freshness(FIVE, NOW - 3 * H, null, false, NOW)).toBe('ok')
  })
  test('janela renovou sem leitura nova: desatualizado', () => {
    expect(freshness(FIVE, NOW, null, false, afterReset)).toBe('stale')
  })
  test('com resposta em andamento: atualizando', () => {
    expect(freshness(FIVE, NOW, null, true, afterReset)).toBe('updating')
  })
  test('resposta com erro depois da renovação: falha', () => {
    expect(freshness(FIVE, NOW, { at: afterReset, reason: 'turn.error' }, false, afterReset + 1)).toBe('failed')
  })
  test('sem dados: "none", nunca 0%', () => {
    expect(freshness(null, null, null, false, NOW)).toBe('none')
  })
})

describe('estado do cache', () => {
  test('quente, morno, frio, novo e desconhecido', () => {
    expect(temperature(NOW - 10 * 60_000, true, NOW).kind).toBe('hot')
    expect(temperature(NOW - 50 * 60_000, true, NOW).kind).toBe('warm')
    expect(temperature(NOW - 3 * 24 * H, true, NOW).kind).toBe('cold')
    expect(temperature(null, false, NOW).kind).toBe('new')
    // Sem registro: não vira "frio".
    expect(temperature(null, true, NOW).kind).toBe('unknown')
  })
  test('formas diferentes, não só cor', () => {
    const hot = dotSvg(temperature(NOW, true, NOW), false)
    const cold = dotSvg(temperature(NOW - 2 * H, true, NOW), false)
    expect(hot.includes('filter="url(#g)"')).toBe(true)
    expect(cold.includes('fill="none"')).toBe(true)
    expect(temperature(NOW, true, NOW).detail.includes('não mede a qualidade do raciocínio')).toBe(true)
  })
})

describe('anel de contexto', () => {
  test('0%, intermediário, 100% e sem leitura', () => {
    expect(ringSvg(0).includes('>0</text>')).toBe(true)
    expect(ringSvg(0).includes('stroke-dasharray="0')).toBe(false)
    expect(ringSvg(62).includes('>62</text>')).toBe(true)
    expect(ringSvg(100).includes('>100</text>')).toBe(true)
    expect(ringSvg(null).includes('>—</text>')).toBe(true)
  })
})

describe('movimento reduzido', () => {
  test('animações desligadas por prefers-reduced-motion', () => {
    for (const s of [barSvg({ from: 10, to: 60, at: 0 }, 12), dotSvg(temperature(NOW, true, NOW), true)]) {
      expect(s.includes('prefers-reduced-motion')).toBe(true)
    }
  })
})

describe('responsividade e estabilidade', () => {
  test('níveis pela largura da própria faixa', () => {
    const m = baseModel()
    const need = { wide: needed(m, 'wide'), medium: needed(m, 'medium'), narrow: needed(m, 'narrow'), tight: needed(m, 'tight') }
    console.log('colunas necessárias:', JSON.stringify(need))
    expect(pickTier(m, 200)).toBe('wide')
    expect(pickTier(m, need.wide - 1)).toBe('medium')
    expect(pickTier(m, need.medium - 1)).toBe('narrow')
    expect(pickTier(m, need.narrow - 1)).toBe('tight')
    // Menor largura verificada: 40 colunas cabem no nível mais compacto.
    expect(need.tight).toBeLessThan(41)
  })
  test('trocar a opção exibida não muda o nível (reserva pela maior)', () => {
    const a = needed(baseModel({ slotIdx: 0 }), 'wide')
    const b = needed(baseModel({ slotIdx: 1 }), 'wide')
    expect(a).toBe(b)
  })
  test('1h00 → 59m não muda a largura reservada', () => {
    const at = (min: number) => needed(baseModel({ now: Date.parse(FIVE.resetsAt) - min * 60_000 }), 'medium')
    expect(at(60)).toBe(at(59))
  })
})

// ------------------------------------------------------------------
// Desenho completo (terminal e desktop)
// ------------------------------------------------------------------

type Scenario = {
  surface?: 'terminal' | 'desktop'
  columns: number
  working?: boolean
  focus?: string | null
  five?: unknown
  week?: unknown
  ctx?: number | null
  lastMin?: number | null
  measuredMinAgo?: number | null
  failure?: unknown
  pace?: string
  slot?: number
  weekSlot?: number
  now?: number
}

const mount = async ($: any, on: any, s: Scenario) => {
  const now = s.now ?? NOW
  on('clock.now', () => ({ value: now }))
  const values: Record<string, unknown> = {
    usage: { five: s.five === undefined ? FIVE : s.five, week: s.week === undefined ? WEEK : s.week },
    hasContext: true,
    ctxPercent: s.ctx === undefined ? 62 : s.ctx,
    lastReply: s.lastMin === undefined ? now - 10 * 60_000 : s.lastMin === null ? null : now - s.lastMin * 60_000,
    lastMeasure: s.measuredMinAgo === undefined ? now - 2 * 60_000 : s.measuredMinAgo === null ? null : now - s.measuredMinAgo * 60_000,
    failure: s.failure ?? null,
    tick: 0,
    fill: { from: 94, to: 94, at: 0 },
    pulse: false,
    slot: s.slot ?? 0,
    weekSlot: s.weekSlot ?? 0,
    pace: { level: s.pace ?? 'elevated', window: FIVE.resetsAt },
    focusKey: s.focus ?? null,
  }
  on('state.get', (_: any, e: any) => ({ value: { value: values[e.key], version: 1 } }))
  return $.ui.mount({
    plugin: 'usage-band', component: 'AbovePrompt', surface: s.surface ?? 'terminal',
    props: { hasSurvey: false, isWorking: !!s.working, maxRows: 10, bodyColumns: s.columns } as any,
  } as any)
}

const visible = (node: any): string => {
  if (typeof node === 'string') return node
  if (!node || typeof node !== 'object') return ''
  if (node.props?.position === 'absolute') return ''
  if (node.type === 'Button') return node.props?.label ?? (node.children ?? []).map(visible).join('')
  if (node.type === 'Svg') return `[svg:${node.props.alt}]`
  const kids = (node.children ?? []).map(visible)
  return node.type === 'Box' && node.props?.flexDirection === 'row' ? kids.filter(Boolean).join(' ') : kids.join('')
}

const dump = async (name: string, ui: any) => {
  const tree = await ui.drawn()
  console.log(`TREE::${name}::${JSON.stringify(tree)}`)
  return tree
}

const PREVIEWS: [string, Scenario][] = [
  ['larga', { columns: 120 }],
  ['media', { columns: 70 }],
  ['estreita', { columns: 52 }],
  ['minima', { columns: 40 }],
]

for (const surface of ['terminal', 'desktop'] as const) {
  for (const [name, sc] of PREVIEWS) {
    test(`${surface} ${name}: uma linha`, async ($, on) => {
      const ui = await mount($, on, { ...sc, surface })
      const tree = await dump(`${surface}-${name}`, ui)
      expect(tree.props.flexDirection).toBe('row')
      expect(tree.props.flexWrap).toBe('nowrap')
      const line = visible(tree)
      console.log(`${surface} ${name} (${sc.columns} col): ${line}`)
      expect(line.includes('94%')).toBe(true)
      expect(line.includes('20%')).toBe(false)
      expect(line.includes('Semana')).toBe(false)
      await ui.unmount()
    })
  }
}

test('larga mostra rótulos completos e texto do cache', async ($, on) => {
  const ui = await mount($, on, { columns: 120 })
  const line = visible(await ui.drawn())
  expect(line.includes('Renova em 1h46')).toBe(true)
  expect(line.includes('Quente')).toBe(true)
  await ui.unmount()
})

test('estreita: sem barra, rótulos curtos, só o símbolo do cache', async ($, on) => {
  const ui = await mount($, on, { columns: 26 })
  const line = visible(await ui.drawn())
  expect(line.includes('━')).toBe(false)
  expect(line.includes('Quente')).toBe(false)
  expect(line.includes('◉')).toBe(true)
  await ui.unmount()
})

for (const [level, glyph] of [['normal', '→'], ['elevated', '↗'], ['high', '↑'], ['calculating', '…']] as const) {
  test(`ritmo ${level} → ${glyph}`, async ($, on) => {
    const ui = await mount($, on, { columns: 120, pace: level })
    const b: any = await ui.find({ type: 'Button', key: 'pace' })
    expect(visible(b)).toBe(glyph)
    await ui.unmount()
  })
}

for (const [idx, prefix] of [[0, 'Renova em'], [1, 'Renova às']] as const) {
  test(`renovação das 5 h, opção ${idx}: ${prefix}`, async ($, on) => {
    const ui = await mount($, on, { columns: 120, slot: idx })
    const b: any = await ui.find({ type: 'Button', key: 'slot' })
    expect(b.props.label.startsWith(prefix)).toBe(true)
    await ui.unmount()
  })
}

test('preferência antiga (opções removidas) continua válida', async ($, on) => {
  const ui = await mount($, on, { columns: 120, slot: 2 })
  const b: any = await ui.find({ type: 'Button', key: 'slot' })
  expect(b.props.label.startsWith('Renova em')).toBe(true)
  await ui.unmount()
})


for (const ctx of [0, 37, 100, null]) {
  test(`contexto ${ctx === null ? 'sem leitura' : ctx + '%'}`, async ($, on) => {
    const ui = await mount($, on, { columns: 120, ctx })
    const b: any = await ui.find({ type: 'Button', key: 'ctx' })
    console.log(`contexto ${ctx}: ${visible(b)}`)
    expect(visible(b).endsWith(ctx === null ? '—' : String(ctx))).toBe(true)
    await ui.unmount()
  })
}

test('dados ausentes viram "—", nunca 0%', async ($, on) => {
  const ui = await mount($, on, { columns: 120, five: null, week: null, ctx: null, lastMin: null })
  const line = visible(await dump('terminal-ausente', ui))
  console.log('ausente:', line)
  expect(line.includes('0%')).toBe(false)
  expect(line.includes('—')).toBe(true)
  await ui.unmount()
})

test('janela vencida sem leitura: ⟳ só nos dados afetados', async ($, on) => {
  const later = Date.parse(FIVE.resetsAt) + 10 * 60_000
  const ui = await mount($, on, { columns: 120, now: later, measuredMinAgo: 120 })
  const line = visible(await dump('terminal-desatualizado', ui))
  console.log('desatualizado:', line)
  expect(line.split('⟳').length - 1).toBe(1) // só a janela de 5 h; a semana segue válida
  expect(line.includes('Renovou')).toBe(true)
  expect(line.includes('94%')).toBe(true) // não zera o consumo
  await ui.unmount()
})

test('atualizando e falha são distintos', async ($, on) => {
  const later = Date.parse(FIVE.resetsAt) + 10 * 60_000
  let ui = await mount($, on, { columns: 120, now: later, measuredMinAgo: 120, working: true })
  expect(visible(await ui.drawn()).includes('⋯')).toBe(true)
  await ui.unmount()
})

test('falha de atualização', async ($, on) => {
  const later = Date.parse(FIVE.resetsAt) + 10 * 60_000
  const ui = await mount($, on, { columns: 120, now: later, measuredMinAgo: 120, failure: { at: later - 60_000, reason: 'turn.error' } })
  expect(visible(await ui.drawn()).includes('⚠')).toBe(true)
  await ui.unmount()
})

test('foco pelo teclado mostra o cartão de detalhes, sem mudar a altura', async ($, on) => {
  const ui = await mount($, on, { columns: 120, focus: 'pace' })
  const cards = (await ui.drawn()).children.filter((c: any) => c?.props?.position === 'absolute')
  const shown = cards.filter((c: any) => c.props.display === 'flex')
  expect(shown.length).toBe(1)
  expect(shown[0].props.top).toBe(0)
  expect(visible({ ...shown[0], props: {} })).toBe('Ritmo elevado')
  // Todos os cartões revelam por hover no mesmo escopo do item.
  expect(cards.filter((c: any) => c.props.display === 'none').every((c: any) => c.hover?.display === 'flex' && c.hover?.scope)).toBe(true)
  await ui.unmount()
})

test('cartões de cada item', async ($, on) => {
  const ui = await mount($, on, { columns: 120 })
  const cards = (await ui.drawn()).children.filter((c: any) => c?.props?.position === 'absolute')
  for (const c of cards) console.log(`cartão ${c.key ?? c.props.key}: ${visible({ ...c, props: {} })}`)
  const texts = cards.map((c: any) => visible({ ...c, props: {} }))
  expect(texts.includes('Contexto: 62% ocupado')).toBe(true)
  expect(texts.some((t: string) => t.startsWith('Estado do cache: quente ·'))).toBe(true)
  expect(texts.some((t: string) => t.includes('semanal'))).toBe(false)
  await ui.unmount()
})

test('todo item clicável é um Button (alcançável por teclado)', async ($, on) => {
  const ui = await mount($, on, { columns: 120 })
  const keys = (await ui.findAll({ type: 'Button' })).map((b: any) => b.key)
  console.log('botões:', keys.join(', '))
  for (const k of ['five', 'pace', 'slot', 'ctx', 'cacheGlyph', 'cache']) expect(keys.includes(k)).toBe(true)
  await ui.unmount()
})

// Cenários extras desenhados no desktop, usados nas prévias visuais.
const later = Date.parse(FIVE.resetsAt) + 10 * 60_000
const EXTRA: [string, Scenario][] = [
  ['foco-cache', { columns: 120, focus: 'cache' }],
  ['foco-renovacao', { columns: 70, focus: 'slot' }],
  ['desatualizado', { columns: 120, now: later, measuredMinAgo: 120 }],
  ['atualizando', { columns: 120, now: later, measuredMinAgo: 120, working: true }],
  ['falha', { columns: 120, now: later, measuredMinAgo: 120, failure: { at: later - 60_000, reason: 'turn.error' } }],
  ['ausente', { columns: 120, five: null, week: null, ctx: null, lastMin: null }],
  ['ritmo-normal-morno', { columns: 120, pace: 'normal', lastMin: 50, ctx: 0 }],
  ['ritmo-alto-frio', { columns: 120, pace: 'high', lastMin: 300, ctx: 100 }],
  ['calculando-trabalhando', { columns: 120, pace: 'calculating', working: true, ctx: 37 }],
  ['opcoes-alternadas', { columns: 120, slot: 1, weekSlot: 1 }],
  ['macbook-85', { columns: 85 }],
  ['macbook-85-horario', { columns: 85, slot: 1 }],
  ['macbook-85-semdados', { columns: 85, five: null, week: null, ctx: null, lastMin: null }],
  ['macbook-60', { columns: 60 }],
]
for (const [name, sc] of EXTRA) {
  test(`prévia ${name}`, async ($, on) => {
    const ui = await mount($, on, { ...sc, surface: 'desktop' })
    await dump(`desktop-${name}`, ui)
    await ui.unmount()
  })
}

test('cede a linha para um alerta do Clawd e só para ele', async ($, on) => {
  on('ui.render', ($: any, e: any) => {
    const { Box, Text } = $.ui.resolve(e)
    return <Box key="clawd-alert"><Text>🦀 Clawd: alerta</Text></Box>
  })
  const ui = await mount($, on, { columns: 120 })
  expect(JSON.stringify(await ui.drawn()).includes('🦀 Clawd: alerta')).toBe(true)
  await ui.unmount()
})

test('qualquer outro desenho embaixo não toma a faixa', async ($, on) => {
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>outra coisa</Text>
  })
  const ui = await mount($, on, { columns: 120 })
  const s = JSON.stringify(await ui.drawn())
  expect(s.includes('outra coisa')).toBe(false)
  expect(s.includes('94%')).toBe(true)
  await ui.unmount()
})
