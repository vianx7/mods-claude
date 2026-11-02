import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, SessionRateLimit, SessionUsage, Timer } from 'claude-code'

import type { Failure, Fill, Limit, PaceLevel, PaceState, Usage } from '../types'

// =====================================================================
// Estado ($.state; sobrevive a recargas do mod dentro da sessão)
// =====================================================================

const usage = atom({ plugin: 'usage-band', key: 'usage' } as const, { five: null, week: null } as Usage)
const hasContext = atom({ plugin: 'usage-band', key: 'hasContext' } as const, false)
const ctxPercent = atom({ plugin: 'usage-band', key: 'ctxPercent' } as const, null as number | null)
const lastReply = atom({ plugin: 'usage-band', key: 'lastReply' } as const, null as number | null)
const lastMeasure = atom({ plugin: 'usage-band', key: 'lastMeasure' } as const, null as number | null)
const failure = atom({ plugin: 'usage-band', key: 'failure' } as const, null as Failure | null)
const tick = atom({ plugin: 'usage-band', key: 'tick' } as const, 0)
const fill = atom({ plugin: 'usage-band', key: 'fill' } as const, { from: 0, to: 0, at: 0 } as Fill)
const pulse = atom({ plugin: 'usage-band', key: 'pulse' } as const, false)
// Preferência já existente: qual informação o botão da renovação das 5 h mostra.
const slot = atom({ plugin: 'usage-band', key: 'slot' } as const, 0)
const pace = atom({ plugin: 'usage-band', key: 'pace' } as const, { level: 'calculating', window: null } as PaceState)
const focusKey = atom({ plugin: 'usage-band', key: 'focusKey' } as const, null as string | null)

// =====================================================================
// Constantes
// =====================================================================

const MIN = 60_000
const HOUR = 60 * MIN
const WINDOW_MS = 5 * HOUR
// Cache de prompt do Claude Code (assinatura): 1 h depois da última resposta.
const CACHE_MIN = 60
const WARM_FROM_MIN = 45
const FILL_MS = 900
const FOCUS_CARD_MS = 8000

// Ritmo (ver README): R = consumo projetado para o fim da janela / 100%.
const PACE_MIN_ELAPSED = 0.1 // 30 min de janela antes de classificar
const PACE_UP = { elevated: 0.9, high: 1.25 } as const
const PACE_HYSTERESIS = 0.1

// Paleta do sistema da Apple.
const BLUE = '#0A84FF'
const ORANGE = '#FF9F0A'
const RED = '#FF453A'
const NEON_RED = '#FF375F'
const YELLOW = '#FFD60A'
const ICE = '#64D2FF'
const GRAY = '#8E8E93'
const CARD_BG = '#2C2C2E'
const CARD_FG = '#F2F2F7'

// =====================================================================
// Formatação
// =====================================================================

const pick = (limits: SessionRateLimit[], kind: string): Limit | null => {
  const l = limits.find(x => x.kind === kind)
  return l ? { percentUsed: l.percentUsed, resetsAt: l.resetsAt } : null
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Tempo compacto: 59m, 1h46, 23h05, 1d6h, 3d. */
export const fmtShort = (min: number): string => {
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h${pad2(min % 60)}`
  const d = Math.floor(h / 24)
  if (d < 2) return `${d}d${h % 24}h`
  return `${d}d`
}

/** Tempo por extenso para os detalhes: 1 h 46 min, 4 d 21 h. */
const fmtLong = (min: number): string => {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return min % 60 ? `${h} h ${min % 60} min` : `${h} h`
  const d = Math.floor(h / 24)
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`
}

const minutesUntil = (iso: string | undefined, now: number): number | null => {
  if (!iso) return null
  const ms = Date.parse(iso) - now
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / MIN)) : null
}

// Fuso horário local de quem usa (o da máquina onde o Claude Code roda).
const clockTime = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

const ago = (t: number | null, now: number): string => {
  if (t === null) return 'Ainda sem leitura nesta sessão'
  const m = Math.floor((now - t) / MIN)
  return m < 1 ? 'Última atualização há menos de 1 minuto' : `Última atualização há ${fmtLong(m)}`
}

const barColor = (pct: number) => (pct >= 90 ? RED : pct >= 75 ? ORANGE : BLUE)
const themeTint = (pct: number) => (pct >= 90 ? 'error' : pct >= 75 ? 'warning' : 'suggestion')

// =====================================================================
// Ritmo: três estados com histerese
// =====================================================================

/** R = (% usado / fração da janela já passada) / 100; null sem histórico. */
export const paceRatio = (five: Limit, now: number): number | null => {
  const left = five.resetsAt ? Date.parse(five.resetsAt) - now : NaN
  if (!Number.isFinite(left) || left <= 0) return null
  const elapsed = (WINDOW_MS - left) / WINDOW_MS
  if (elapsed < PACE_MIN_ELAPSED) return null
  return five.percentUsed / 100 / elapsed
}

/** Sobe ao cruzar o limiar; só desce quando fica 0,1 abaixo dele. */
export const classifyPace = (prev: PaceLevel, r: number | null): PaceLevel => {
  if (r === null) return 'calculating'
  const rank = (l: PaceLevel) => (l === 'high' ? 2 : l === 'elevated' ? 1 : 0)
  const up: PaceLevel = r >= PACE_UP.high ? 'high' : r >= PACE_UP.elevated ? 'elevated' : 'normal'
  const p = prev === 'calculating' ? 'normal' : prev
  if (rank(up) >= rank(p)) return up
  if (p === 'high') return r < PACE_UP.high - PACE_HYSTERESIS ? (r < PACE_UP.elevated - PACE_HYSTERESIS ? 'normal' : 'elevated') : 'high'
  return r < PACE_UP.elevated - PACE_HYSTERESIS ? 'normal' : 'elevated'
}

const PACE_VIEW: Record<PaceLevel, { glyph: string; color: string; name: string }> = {
  calculating: { glyph: '…', color: 'inactive', name: 'Ritmo: calculando (pouco histórico nesta janela)' },
  normal: { glyph: '→', color: 'inactive', name: 'Ritmo normal' },
  elevated: { glyph: '↗', color: ORANGE, name: 'Ritmo elevado' },
  high: { glyph: '↑', color: RED, name: 'Ritmo muito elevado' },
}

// =====================================================================
// Estado do cache (quente / morno / frio)
// =====================================================================

type TempKind = 'hot' | 'warm' | 'cold' | 'new' | 'unknown'
type Temp = { kind: TempKind; label: string; glyph: string; color: string; detail: string }

export const temperature = (last: number | null, ctx: boolean, now: number): Temp => {
  const tail = 'não mede a qualidade do raciocínio'
  if (last === null) {
    return ctx
      ? { kind: 'unknown', label: 'Cache —', glyph: '◌', color: GRAY, detail: `Estado do cache: desconhecido · sem registro da última resposta desta conversa · ${tail}` }
      : { kind: 'new', label: 'Novo', glyph: '◌', color: GRAY, detail: `Estado do cache: conversa nova, ainda sem histórico · ${tail}` }
  }
  const age = Math.floor((now - last) / MIN)
  if (age < WARM_FROM_MIN) {
    return { kind: 'hot', label: 'Quente', glyph: '◉', color: NEON_RED, detail: `Estado do cache: quente · última resposta há ${fmtLong(age)} · histórico em cache, expira em ${fmtLong(CACHE_MIN - age)} · ${tail}` }
  }
  if (age < CACHE_MIN) {
    return { kind: 'warm', label: 'Morno', glyph: '◐', color: YELLOW, detail: `Estado do cache: morno · última resposta há ${fmtLong(age)} · expira em ${fmtLong(CACHE_MIN - age)} · ${tail}` }
  }
  return { kind: 'cold', label: 'Frio', glyph: '○', color: ICE, detail: `Estado do cache: frio · última resposta há ${fmtLong(age)} · a próxima mensagem relê o histórico sem desconto · ${tail}` }
}

// =====================================================================
// Atualidade dos dados
// =====================================================================

type Freshness = 'none' | 'ok' | 'stale' | 'updating' | 'failed'

/**
 * A fonte (cabeçalhos da API) só muda quando há uma resposta, então ociosidade
 * não é atraso. Atraso relevante: o horário de renovação conhecido já passou e
 * nenhuma leitura chegou depois dele, ou seja, o valor mostrado é de uma janela
 * encerrada.
 */
export const freshness = (l: Limit | null, measuredAt: number | null, fail: Failure | null, working: boolean, now: number): Freshness => {
  if (!l) return fail ? 'failed' : 'none'
  const reset = l.resetsAt ? Date.parse(l.resetsAt) : NaN
  if (!Number.isFinite(reset) || now < reset || (measuredAt !== null && measuredAt >= reset)) return 'ok'
  if (working) return 'updating'
  if (fail && fail.at >= reset) return 'failed'
  return 'stale'
}

const FRESH_VIEW: Record<Freshness, { glyph: string; color: string; note: string }> = {
  none: { glyph: '', color: 'inactive', note: '' },
  ok: { glyph: '', color: 'inactive', note: '' },
  stale: { glyph: '⟳', color: 'inactive', note: 'Desatualizado: a janela já renovou e a nova leitura chega com a próxima resposta.' },
  updating: { glyph: '⋯', color: 'suggestion', note: 'Atualizando: aguardando a leitura da resposta em andamento.' },
  failed: { glyph: '⚠', color: 'warning', note: 'Falha na atualização: a última resposta terminou com erro e não trouxe leitura.' },
}

// =====================================================================
// Layout responsivo: escolhe o nível pela largura da própria faixa
// =====================================================================

export type Tier = 'wide' | 'medium' | 'narrow' | 'tight'
const TIERS: Tier[] = ['wide', 'medium', 'narrow', 'tight']
const BAR_CELLS: Record<Tier, number> = { wide: 12, medium: 6, narrow: 0, tight: 0 }

type Model = {
  now: number
  five: Limit | null
  ctx: number | null
  paceLevel: PaceLevel
  slotIdx: number
  temp: Temp
  fiveFresh: Freshness
}

/** As duas opções do botão de renovação das 5 h, por nível. */
export const slotLabels = (m: Model, tier: Tier): string[] => {
  const c = tier !== 'wide'
  const reset = m.five?.resetsAt
  const left = minutesUntil(reset, m.now)
  const expired = left === 0
  return [
    // 1) Tempo até renovar
    !reset || left === null ? (c ? '—' : 'Renova em —') : expired ? (c ? 'renovou' : 'Renovou') : c ? fmtShort(left) : `Renova em ${fmtShort(left)}`,
    // 2) Horário da renovação (fuso local)
    !reset ? (c ? '—' : 'Renova às —') : expired ? (c ? clockTime(reset) : `Renovou às ${clockTime(reset)}`) : c ? clockTime(reset) : `Renova às ${clockTime(reset)}`,
  ]
}

const maxLen = (xs: string[]) => xs.reduce((a, x) => Math.max(a, [...x].length), 0)

/** Larguras reservadas (em colunas) de cada item; não mudam quando o valor muda. */
export const reserve = (m: Model, tier: Tier) => {
  return {
    fiveLabel: 2,
    bar: BAR_CELLS[tier],
    pct: 4, // "100%"
    paceG: 1,
    fresh: 1,
    slot: maxLen(slotLabels(m, tier)),
    ctx: 3,
    cacheLabel: tier === 'wide' ? 7 : 0, // "Quente "
    cacheG: 2,
  }
}

export const needed = (m: Model, tier: Tier): number => {
  const r = reserve(m, tier)
  const gap = tier === 'tight' ? 1 : 2
  const five = r.fiveLabel + 1 + (r.bar ? r.bar + 1 : 0) + r.pct + 1 + r.paceG
  const cache = r.cacheG + (r.cacheLabel ? r.cacheLabel + 1 : 0)
  return 2 + five + gap + r.slot + gap + r.ctx + gap + cache
}

export const pickTier = (m: Model, columns: number): Tier => TIERS.find(t => needed(m, t) <= columns) ?? 'tight'

// =====================================================================
// SVG (app desktop): barra, anel de contexto e bolinha do cache
// Animações em CSS, desligadas com prefers-reduced-motion.
// =====================================================================

const NO_MOTION = '@media (prefers-reduced-motion: reduce){*{animation:none!important}}'

export const barSvg = (f: Fill, cells: number) => {
  const W = cells * 8
  const to = (Math.min(100, Math.max(0, f.to)) / 100) * W
  const from = (Math.min(100, Math.max(0, f.from)) / 100) * W
  const anim = to > 0 && from !== to
  const style = anim
    ? `<style>.f{transform-origin:0 0;animation:g ${FILL_MS}ms cubic-bezier(.2,.8,.2,1) both}@keyframes g{from{transform:scaleX(${(from / to).toFixed(3)})}}${NO_MOTION}</style>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="8" viewBox="0 0 ${W} 8">${style}<rect x="0" y="2" width="${W}" height="4" rx="2" fill="${GRAY}" fill-opacity="0.28"/><rect class="f" x="0" y="2" width="${to.toFixed(1)}" height="4" rx="2" fill="${barColor(f.to)}"/></svg>`
}

export const ringSvg = (pct: number | null) => {
  const R = 9
  const C = 2 * Math.PI * R
  const p = pct === null ? 0 : Math.min(100, Math.max(0, pct))
  const color = p >= 95 ? RED : p >= 80 ? ORANGE : BLUE
  const label = pct === null ? '—' : String(Math.round(p))
  const size = label.length >= 3 ? 7 : 8.5
  const track = pct === null
    ? `<circle cx="12" cy="12" r="${R}" fill="none" stroke="${GRAY}" stroke-width="2" stroke-dasharray="2 2.6"/>`
    : `<circle cx="12" cy="12" r="${R}" fill="none" stroke="${GRAY}" stroke-opacity="0.3" stroke-width="2.4"/>`
  const arc = pct === null || p === 0
    ? ''
    : `<circle cx="12" cy="12" r="${R}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="${((p / 100) * C).toFixed(2)} ${C.toFixed(2)}" transform="rotate(-90 12 12)"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><style>text{fill:#1C1C1E;font:600 ${size}px -apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif;font-variant-numeric:tabular-nums}@media (prefers-color-scheme:dark){text{fill:#F2F2F7}}</style>${track}${arc}<text x="12" y="12" text-anchor="middle" dominant-baseline="central">${label}</text></svg>`
}

export const dotSvg = (t: Temp, working: boolean) => {
  const c = t.color
  // Forma além da cor: cheio (quente), meio (morno), contorno (frio), tracejado (sem dado).
  const shape =
    t.kind === 'hot'
      ? `<circle class="core" cx="9" cy="9" r="4.5" fill="${c}" filter="url(#g)"/>`
      : t.kind === 'warm'
        ? `<circle class="core" cx="9" cy="9" r="4" fill="none" stroke="${c}" stroke-width="1.6"/><path class="core" d="M9 5a4 4 0 0 0 0 8z" fill="${c}"/>`
        : t.kind === 'cold'
          ? `<circle class="core" cx="9" cy="9" r="4" fill="none" stroke="${c}" stroke-width="1.8"/>`
          : `<circle class="core" cx="9" cy="9" r="4" fill="none" stroke="${c}" stroke-width="1.5" stroke-dasharray="1.6 1.6"/>`
  const glow = `<defs><filter id="g" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`
  const ripple = working ? `<circle class="rip" cx="9" cy="9" r="4" fill="none" stroke="${c}" stroke-width="1.4"/>` : ''
  const css = working
    ? `.rip{transform-origin:9px 9px;animation:r 1.6s cubic-bezier(.2,.8,.2,1) infinite}@keyframes r{from{transform:scale(1);opacity:.8}to{transform:scale(2);opacity:0}}.core{animation:b 1.6s ease-in-out infinite}@keyframes b{50%{opacity:.55}}`
    : t.kind === 'warm'
      ? `.core{animation:w 6s infinite}@keyframes w{0%,90%,100%{opacity:1}95%{opacity:.3}}`
      : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><style>${css}${NO_MOTION}</style>${glow}${ripple}${shape}</svg>`
}

const ringGlyph = (pct: number | null) =>
  pct === null ? '◌' : pct >= 88 ? '●' : pct >= 63 ? '◕' : pct >= 38 ? '◑' : pct >= 13 ? '◔' : '○'

// =====================================================================
// Funções que usam $ (declaradas no topo, como o motor exige)
// =====================================================================

async function storeKey($: EngineInterface) {
  return `lastReply:${await $.session.id()}`
}

async function alertOnce($: EngineInterface, key: string, text: string) {
  try {
    if ((await $.store.get(key)) === true) return
    await $.store.set(key, true)
  } catch {}
  let sent = false
  try {
    sent = (await $.ui.notify(text, { title: 'Uso do Claude' })).isSent
  } catch {}
  if (!sent) $.ui.toast(text, { timeoutMs: 8000 })
}

// Só avisa no que importa, uma vez por janela. Sem previsão de esgotamento.
async function checkAlerts($: EngineInterface, u: Usage, level: PaceLevel) {
  const now = await $.clock.now()
  const f = u.five
  if (f) {
    const w = f.resetsAt ?? 'sem-data'
    const left = minutesUntil(f.resetsAt, now)
    const renew = left !== null ? ` Renova em ${fmtLong(left)}.` : ''
    if (f.percentUsed >= 100) await alertOnce($, `alert:five100:${w}`, `Limite de 5 h atingido.${renew}`)
    else if (f.percentUsed >= 90) await alertOnce($, `alert:five90:${w}`, `Você usou ${Math.round(f.percentUsed)}% das 5 h.${renew}`)
    else if (f.percentUsed >= 60 && level === 'high') {
      await alertOnce($, `alert:pace:${w}`, `Ritmo muito elevado na janela de 5 h (${Math.round(f.percentUsed)}% usado).${renew}`)
    }
  }
}

let fillTimer: Timer | null = null
let pulseTimer: Timer | null = null
let focusTimer: Timer | null = null

async function absorb($: EngineInterface, u: Pick<SessionUsage, 'rateLimits' | 'context'>, isMeasurement: boolean) {
  const next: Usage = { five: pick(u.rateLimits, 'five_hour'), week: pick(u.rateLimits, 'seven_day') }
  const now = await $.clock.now()
  await update($, usage, () => next)
  await update($, hasContext, () => (u.context.tokens ?? 0) > 0)
  await update($, ctxPercent, () => (typeof u.context.percent === 'number' ? u.context.percent : null))
  if (isMeasurement || next.five || next.week) {
    await update($, lastMeasure, () => now)
    await update($, failure, () => null)
  }

  // Ritmo: reclassifica só quando chega leitura nova (histerese contra oscilação).
  const windowId = next.five?.resetsAt ?? null
  const r = next.five ? paceRatio(next.five, now) : null
  await update($, pace, prev => ({ level: classifyPace(prev.window === windowId ? prev.level : 'calculating', r), window: windowId }))

  // Barra: parte de onde estava e enche até o valor novo.
  const target = next.five?.percentUsed ?? 0
  const cur = await read($, fill)
  if (target !== cur.to) {
    const shown = cur.from + (cur.to - cur.from) * Math.min(1, Math.max(0, (now - cur.at) / FILL_MS))
    await update($, fill, () => ({ from: shown, to: target, at: now }))
    fillTimer?.cancel()
    fillTimer = $.clock.every(50, async () => {
      await update($, tick, n => n + 1)
      if ((await $.clock.now()) - now > FILL_MS) {
        fillTimer?.cancel()
        fillTimer = null
        await update($, fill, f => ({ ...f, from: f.to }))
      }
    })
  }
  await checkAlerts($, next, (await read($, pace)).level)
}

async function markReply($: EngineInterface) {
  const now = await $.clock.now()
  await update($, lastReply, () => now)
  try {
    await $.store.set(await storeKey($), now)
  } catch {}
}

async function startPulse($: EngineInterface) {
  pulseTimer?.cancel()
  pulseTimer = $.clock.every(700, () => update($, pulse, p => !p))
}

async function stopPulse($: EngineInterface) {
  pulseTimer?.cancel()
  pulseTimer = null
  await update($, pulse, () => false)
}

async function showCard($: EngineInterface, key: string | null) {
  await update($, focusKey, () => key)
  focusTimer?.cancel()
  focusTimer = key ? $.clock.after(FOCUS_CARD_MS, () => update($, focusKey, () => null)) : null
}

async function cycleSlot($: EngineInterface) {
  await update($, slot, n => (n + 1) % 2)
  try {
    await $.store.set('pref:slot', await read($, slot))
  } catch {}
  await showCard($, 'slot')
}


// =====================================================================
// Registro
// =====================================================================

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    try {
      await absorb($, await $.session.usage(), false)
    } catch {
      const t = await $.clock.now()
      await update($, failure, () => ({ at: t, reason: 'session.usage' }))
    }
    try {
      const saved = await $.store.get(await storeKey($))
      if (typeof saved === 'number') await update($, lastReply, cur => cur ?? saved)
      // Preferências de exibição guardadas entre sessões.
      const s = await $.store.get('pref:slot')
      if (typeof s === 'number') await update($, slot, () => s)
    } catch {}
    $.clock.every(MIN, () => update($, tick, n => n + 1))
    return result
  })

  on('session.measure', async ($, e, next) => {
    await absorb($, e, true)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await startPulse($)
    await showCard($, null)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if ((e as { agentId?: string }).agentId === undefined) {
      if (e.reason === 'error') {
        const now = await $.clock.now()
        await update($, failure, () => ({ at: now, reason: 'turn.error' }))
      } else {
        await markReply($)
      }
      await stopPulse($)
    }
    return next(e)
  })

  // Foco do teclado: mostra os detalhes do item focado no cartão sobreposto.
  on('ui.focus', { component: 'AbovePrompt' }, async ($, e, next) => {
    const el = e.plugin === 'usage-band' && e.element ? (e.element === 'cacheGlyph' ? 'cache' : e.element) : null
    await showCard($, el)
    return next(e)
  })

  // ===================================================================
  // Desenho: sempre uma linha
  // ===================================================================

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const [u, ctxFilled, ctxPct, last, measured, fail, f, beat, slotIdx, paceState, focused] = await Promise.all([
      read($, usage), read($, hasContext), read($, ctxPercent), read($, lastReply), read($, lastMeasure),
      read($, failure), read($, fill), read($, pulse), read($, slot), read($, pace), read($, focusKey),
    ])
    await read($, tick)
    const now = await $.clock.now()
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    // O terminal não desenha SVG: lá barra, anel e bolinha são texto.
    const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : null
    const working = e.props.isWorking

    const fiveFresh = freshness(u.five, measured, fail, working, now)
    const temp = temperature(last, ctxFilled, now)
    const model: Model = {
      now, five: u.five, ctx: ctxPct,
      paceLevel: u.five && fiveFresh === 'ok' ? paceState.level : 'calculating',
      slotIdx, temp, fiveFresh,
    }
    // No desktop os botões são nativos e ocupam mais que as células do texto.
    const tier = pickTier(model, e.props.bodyColumns - (Svg ? 12 : 0))
    const r = reserve(model, tier)
    const wide = tier === 'wide'
    const updated = ago(measured, now)

    // ---------- detalhes (hover e foco) ----------
    const fivePct = u.five ? `${Math.round(u.five.percentUsed)}%` : '—'
    const paceV = PACE_VIEW[model.paceLevel]
    const fiveLeft = minutesUntil(u.five?.resetsAt, now)
    const noFive = fail && !u.five
      ? 'Falha ao ler o uso da janela de 5 h.'
      : 'Sem dados da janela de 5 h: a leitura chega com a próxima resposta (só em planos de assinatura).'
    const join = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' · ')
    const details: Record<string, string> = {
      five: u.five
        ? join(`Janela de 5 h: ${fivePct} usado`, FRESH_VIEW[fiveFresh].note, updated)
        : noFive,
      pace: u.five ? (fiveFresh === 'ok' ? paceV.name : 'Ritmo: indisponível até a próxima leitura') : 'Ritmo: sem dados da janela de 5 h',
      slot: u.five?.resetsAt
        ? join(
          fiveLeft === 0 ? `Renovação das 5 h: renovou às ${clockTime(u.five.resetsAt)}` : `Renovação das 5 h: às ${clockTime(u.five.resetsAt)}, em ${fmtLong(fiveLeft ?? 0)}`,
          wide && 'clique para alternar',
        )
        : 'Renovação das 5 h: horário ainda não informado pela fonte',
      ctx: ctxPct === null ? 'Contexto: sem leitura ainda (chega com a próxima resposta)' : `Contexto: ${Math.round(ctxPct)}% ocupado`,
      cache: temp.detail,
    }

    // ---------- peças ----------
    const tipScope = (k: string) => `usage-band-tip-${k}`
    const hoverable = (k: string, child: RenderChildren) => (
      <Box key={`hv-${k}`} hover={{ scope: tipScope(k) }} flexDirection="row" alignItems="center" flexShrink={0}>
        {child}
      </Box>
    )
    const fixed = (w: number, child: RenderChildren, align: 'flex-start' | 'flex-end' = 'flex-start') => (
      <Box minWidth={w} flexShrink={0} flexDirection="row" justifyContent={align}>{child}</Box>
    )
    // Só ocupa espaço quando há aviso.
    const freshMark = (fr: Freshness) =>
      FRESH_VIEW[fr].glyph ? <Text color={FRESH_VIEW[fr].color}>{FRESH_VIEW[fr].glyph}</Text> : null

    // 5h
    const fiveDim = fiveFresh !== 'ok'
    const shownFill = f.from + (f.to - f.from) * (1 - Math.pow(1 - Math.min(1, Math.max(0, (now - f.at) / FILL_MS)), 3))
    const cells = r.bar
    const filled = Math.max(0, Math.min(cells, Math.round((shownFill / 100) * cells)))
    const fiveBlock = (
      <Box flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
        <Text color="inactive" size="footnote">5h</Text>
        {cells && u.five ? (
          Svg ? (
            <Svg source={barSvg(f, cells)} alt={`Janela de 5 h: ${fivePct} usado`} />
          ) : (
            <Text dimColor={fiveDim}>
              <Text color={themeTint(shownFill)}>{'━'.repeat(filled)}</Text>
              <Text color="subtle">{'─'.repeat(cells - filled)}</Text>
            </Text>
          )
        ) : null}
        {hoverable('five', fixed(r.pct,
          <Button key="five" plain label={fivePct} dimColor={fiveDim} onPress={() => showCard($, 'five')} />, 'flex-end'))}
        {u.five && fiveFresh === 'ok' ? hoverable('pace', fixed(r.paceG,
          <Button key="pace" plain onPress={() => showCard($, 'pace')}>
            <Text color={paceV.color}>{paceV.glyph}</Text>
          </Button>)) : null}
        {freshMark(fiveFresh)}
      </Box>
    )

    // Renovação das 5 h: "Renova em" ⇄ "Renova às", abreviadas por nível.
    const sLabels = slotLabels(model, tier)
    const slotBlock = hoverable('slot', fixed(r.slot,
      <Button key="slot" plain dimColor label={sLabels[slotIdx % sLabels.length]} onPress={() => cycleSlot($)} />))

    // Contexto: anel de progresso com o número dentro.
    const ctxBlock = hoverable('ctx', Svg ? (
      <Svg source={ringSvg(ctxPct)} alt={ctxPct === null ? 'Contexto: sem leitura' : `Contexto: ${Math.round(ctxPct)}% ocupado`} />
    ) : (
      <Button key="ctx" plain label={`${ringGlyph(ctxPct)}${ctxPct === null ? '—' : Math.round(ctxPct)}`} onPress={() => showCard($, 'ctx')} />
    ))

    // Estado do cache: forma + cor; texto só no nível largo.
    const cacheBlock = hoverable('cache', (
      <Box flexDirection="row" alignItems="center" columnGap={1}>
        {Svg ? (
          <Svg source={dotSvg(temp, working)} alt={working ? `Estado do cache: ${temp.label}, Claude trabalhando` : `Estado do cache: ${temp.label}`} />
        ) : (
          <Button key="cacheGlyph" plain onPress={() => showCard($, 'cache')}>
            <Text color={temp.color} dimColor={working && beat}>{temp.glyph}</Text>
          </Button>
        )}
        {wide ? (
          <Button key="cache" plain onPress={() => showCard($, 'cache')}>
            <Text color={temp.color} weight="semibold">{temp.label}</Text>
          </Button>
        ) : null}
      </Box>
    ))

    // ---------- cartões de detalhe (hover revela; foco mostra) ----------
    const cards = Object.entries(details).map(([k, text]) => (
      <Box
        key={`card-${k}`}
        position="absolute"
        top={0}
        left={0}
        right={0}
        paddingX={1}
        flexDirection="row"
        justifyContent="flex-start"
        alignItems="center"
        backgroundColor={CARD_BG}
        display={focused === k ? 'flex' : 'none'}
        hover={focused === k ? undefined : { scope: tipScope(k), display: 'flex' }}
      >
        <Text color={CARD_FG} wrap="truncate-end">{text}</Text>
      </Box>
    ))

    return (
      <Box position="relative" flexDirection="row" flexWrap="nowrap" justifyContent="space-between" alignItems="center"
        paddingX={1} width="100%" overflow="hidden">
        {fiveBlock}
        {slotBlock}
        {ctxBlock}
        {cacheBlock}
        {cards}
      </Box>
    )
  })
}
