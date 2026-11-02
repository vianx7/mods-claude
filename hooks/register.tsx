import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit, SessionUsage, Timer } from 'claude-code'

import type { Failure, Fill, Limit, PaceLevel, PaceState, Usage, View } from '../types'

// =====================================================================
// Estado
// =====================================================================

const usage = atom({ plugin: 'usage-band', key: 'usage' } as const, { five: null, week: null } as Usage)
const hasContext = atom({ plugin: 'usage-band', key: 'hasContext' } as const, false)
const lastReply = atom({ plugin: 'usage-band', key: 'lastReply' } as const, null as number | null)
const lastMeasure = atom({ plugin: 'usage-band', key: 'lastMeasure' } as const, null as number | null)
const failure = atom({ plugin: 'usage-band', key: 'failure' } as const, null as Failure | null)
const tick = atom({ plugin: 'usage-band', key: 'tick' } as const, 0)
const fill = atom({ plugin: 'usage-band', key: 'fill' } as const, { from: 0, to: 0, at: 0 } as Fill)
const pulse = atom({ plugin: 'usage-band', key: 'pulse' } as const, false)
const pace = atom({ plugin: 'usage-band', key: 'pace' } as const, { level: 'calculating', window: null } as PaceState)
const view = atom({ plugin: 'usage-band', key: 'view' } as const, 'five' as View)

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

// Ritmo: R = consumo projetado para o fim da janela / 100%.
const PACE_MIN_ELAPSED = 0.1
const PACE_UP = { elevated: 0.9, high: 1.25 } as const
const PACE_HYSTERESIS = 0.1

const BLUE = '#0A84FF'
const ORANGE = '#FF9F0A'
const RED = '#FF453A'
const NEON_RED = '#FF375F'
const YELLOW = '#FFD60A'
const ICE = '#64D2FF'
const GRAY = '#8E8E93'

// =====================================================================
// Formatação
// =====================================================================

const pick = (limits: SessionRateLimit[], kind: string): Limit | null => {
  const l = limits.find(x => x.kind === kind)
  return l ? { percentUsed: l.percentUsed, resetsAt: l.resetsAt } : null
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** 59m, 1h46, 23h05, 1d6h, 3d. */
export const fmtShort = (min: number): string => {
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h${pad2(min % 60)}`
  const d = Math.floor(h / 24)
  if (d < 2) return `${d}d${h % 24}h`
  return `${d}d`
}

const minutesUntil = (iso: string | undefined, now: number): number | null => {
  if (!iso) return null
  const ms = Date.parse(iso) - now
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / MIN)) : null
}

const barColor = (pct: number) => (pct >= 90 ? RED : pct >= 75 ? ORANGE : BLUE)
const themeTint = (pct: number) => (pct >= 90 ? 'error' : pct >= 75 ? 'warning' : 'suggestion')

// =====================================================================
// Ritmo (só na janela de 5 h)
// =====================================================================

export const paceRatio = (five: Limit, now: number): number | null => {
  const left = five.resetsAt ? Date.parse(five.resetsAt) - now : NaN
  if (!Number.isFinite(left) || left <= 0) return null
  const elapsed = (WINDOW_MS - left) / WINDOW_MS
  if (elapsed < PACE_MIN_ELAPSED) return null
  return five.percentUsed / 100 / elapsed
}

export const classifyPace = (prev: PaceLevel, r: number | null): PaceLevel => {
  if (r === null) return 'calculating'
  const rank = (l: PaceLevel) => (l === 'high' ? 2 : l === 'elevated' ? 1 : 0)
  const up: PaceLevel = r >= PACE_UP.high ? 'high' : r >= PACE_UP.elevated ? 'elevated' : 'normal'
  const p = prev === 'calculating' ? 'normal' : prev
  if (rank(up) >= rank(p)) return up
  if (p === 'high') return r < PACE_UP.high - PACE_HYSTERESIS ? (r < PACE_UP.elevated - PACE_HYSTERESIS ? 'normal' : 'elevated') : 'high'
  return r < PACE_UP.elevated - PACE_HYSTERESIS ? 'normal' : 'elevated'
}

const PACE_VIEW: Record<PaceLevel, { glyph: string; color: string }> = {
  calculating: { glyph: '', color: 'inactive' },
  normal: { glyph: '→', color: 'inactive' },
  elevated: { glyph: '↗', color: ORANGE },
  high: { glyph: '↑', color: RED },
}

// =====================================================================
// Estado do cache
// =====================================================================

type TempKind = 'hot' | 'warm' | 'cold' | 'new' | 'unknown'
type Temp = { kind: TempKind; label: string; glyph: string; color: string }

export const temperature = (last: number | null, ctx: boolean, now: number): Temp => {
  if (last === null) {
    return ctx
      ? { kind: 'unknown', label: 'Cache —', glyph: '◌', color: GRAY }
      : { kind: 'new', label: 'Novo', glyph: '◌', color: GRAY }
  }
  const age = Math.floor((now - last) / MIN)
  if (age < WARM_FROM_MIN) return { kind: 'hot', label: 'Quente', glyph: '◉', color: NEON_RED }
  if (age < CACHE_MIN) return { kind: 'warm', label: 'Morno', glyph: '◐', color: YELLOW }
  return { kind: 'cold', label: 'Frio', glyph: '○', color: ICE }
}

// =====================================================================
// Atualidade: a fonte só muda quando há resposta; atraso relevante é o
// horário de renovação já ter passado sem nenhuma leitura depois dele.
// =====================================================================

type Freshness = 'none' | 'ok' | 'stale' | 'updating' | 'failed'

export const freshness = (l: Limit | null, measuredAt: number | null, fail: Failure | null, working: boolean, now: number): Freshness => {
  if (!l) return 'none'
  const reset = l.resetsAt ? Date.parse(l.resetsAt) : NaN
  if (!Number.isFinite(reset) || now < reset || (measuredAt !== null && measuredAt >= reset)) return 'ok'
  if (working) return 'updating'
  if (fail && fail.at >= reset) return 'failed'
  return 'stale'
}

const FRESH_GLYPH: Record<Freshness, { glyph: string; color: string }> = {
  none: { glyph: '', color: 'inactive' },
  ok: { glyph: '', color: 'inactive' },
  stale: { glyph: '⟳', color: 'inactive' },
  updating: { glyph: '⋯', color: 'suggestion' },
  failed: { glyph: '⚠', color: 'warning' },
}

// =====================================================================
// Bloco de uso: um texto só, o mesmo formato para 5 h e semana
// =====================================================================

export type Tier = 'wide' | 'medium' | 'narrow'
const BAR_CELLS: Record<Tier, number> = { wide: 12, medium: 6, narrow: 0 }

/** O que o bloco escreve depois da barra, ex.: "94% ↗ · renova em 1h46". */
export const usageText = (v: View, l: Limit | null, now: number, tier: Tier) => {
  const label = v === 'five' ? '5h' : tier === 'narrow' ? '7d' : 'Semana'
  if (!l) return { label, pct: '—', renew: '' }
  const left = minutesUntil(l.resetsAt, now)
  const renew = left === null ? '' : left === 0 ? 'renovou' : tier === 'narrow' ? fmtShort(left) : `renova em ${fmtShort(left)}`
  return { label, pct: `${Math.round(l.percentUsed)}%`, renew }
}

/** Colunas necessárias por nível; reserva o pior caso das duas visões. */
export const needed = (tier: Tier): number => {
  const bar = BAR_CELLS[tier] ? BAR_CELLS[tier] + 1 : 0
  const text = tier === 'narrow' ? '7d 100% ↑ 23h59'.length : 'Semana 100% ↑ · renova em 23h59'.length
  const cache = tier === 'wide' ? '◉ Quente'.length : 1
  return 2 + bar + text + 2 + cache
}

export const pickTier = (columns: number): Tier =>
  (['wide', 'medium'] as Tier[]).find(t => needed(t) <= columns) ?? 'narrow'

// =====================================================================
// SVG (app desktop). Animações respeitam o movimento reduzido.
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

export const dotSvg = (t: Temp, working: boolean) => {
  const c = t.color
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

// =====================================================================
// Funções com $
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

// Só o que importa, uma vez por janela de 5 h.
async function checkAlerts($: EngineInterface, u: Usage, level: PaceLevel) {
  const f = u.five
  if (!f) return
  const now = await $.clock.now()
  const w = f.resetsAt ?? 'sem-data'
  const left = minutesUntil(f.resetsAt, now)
  const renew = left !== null ? ` Renova em ${fmtShort(left)}.` : ''
  if (f.percentUsed >= 100) await alertOnce($, `alert:five100:${w}`, `Limite de 5 h atingido.${renew}`)
  else if (f.percentUsed >= 90) await alertOnce($, `alert:five90:${w}`, `Você usou ${Math.round(f.percentUsed)}% das 5 h.${renew}`)
  else if (f.percentUsed >= 60 && level === 'high') {
    await alertOnce($, `alert:pace:${w}`, `Ritmo muito elevado na janela de 5 h (${Math.round(f.percentUsed)}% usado).${renew}`)
  }
}

let fillTimer: Timer | null = null
let pulseTimer: Timer | null = null

/** Anima a barra do valor mostrado agora até `target`. */
async function animateTo($: EngineInterface, target: number) {
  const now = await $.clock.now()
  const cur = await read($, fill)
  if (target === cur.to) return
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

async function absorb($: EngineInterface, u: Pick<SessionUsage, 'rateLimits' | 'context'>, isMeasurement: boolean) {
  const next: Usage = { five: pick(u.rateLimits, 'five_hour'), week: pick(u.rateLimits, 'seven_day') }
  const now = await $.clock.now()
  await update($, usage, () => next)
  await update($, hasContext, () => (u.context.tokens ?? 0) > 0)
  if (isMeasurement || next.five || next.week) {
    await update($, lastMeasure, () => now)
    await update($, failure, () => null)
  }
  const windowId = next.five?.resetsAt ?? null
  const r = next.five ? paceRatio(next.five, now) : null
  await update($, pace, prev => ({ level: classifyPace(prev.window === windowId ? prev.level : 'calculating', r), window: windowId }))

  const v = await read($, view)
  await animateTo($, (v === 'five' ? next.five : next.week)?.percentUsed ?? 0)
  await checkAlerts($, next, (await read($, pace)).level)
}

/** Clique no bloco: alterna 5 h ⇄ semana; só esse bloco muda. */
async function toggleView($: EngineInterface) {
  await update($, view, v => (v === 'five' ? 'week' : 'five'))
  const v = await read($, view)
  const u = await read($, usage)
  try {
    await $.store.set('pref:view', v)
  } catch {}
  await animateTo($, (v === 'five' ? u.five : u.week)?.percentUsed ?? 0)
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

// =====================================================================
// Registro
// =====================================================================

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    try {
      const v = await $.store.get('pref:view')
      if (v === 'five' || v === 'week') await update($, view, () => v)
    } catch {}
    try {
      await absorb($, await $.session.usage(), false)
    } catch {
      const t = await $.clock.now()
      await update($, failure, () => ({ at: t, reason: 'session.usage' }))
    }
    try {
      const saved = await $.store.get(await storeKey($))
      if (typeof saved === 'number') await update($, lastReply, cur => cur ?? saved)
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

  // ===================================================================
  // Desenho: [barra] [5h 94% ↗ · renova em 1h46]  ...  [● Quente]
  // ===================================================================

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const [u, ctxFilled, last, measured, fail, f, beat, paceState, v] = await Promise.all([
      read($, usage), read($, hasContext), read($, lastReply), read($, lastMeasure),
      read($, failure), read($, fill), read($, pulse), read($, pace), read($, view),
    ])
    await read($, tick)
    const now = await $.clock.now()
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : null
    const working = e.props.isWorking

    // No desktop os botões são nativos e ocupam mais que as células do texto.
    const tier = pickTier(e.props.bodyColumns - (Svg ? 12 : 0))
    const limit = v === 'five' ? u.five : u.week
    const fresh = freshness(limit, measured, fail, working, now)
    const t = usageText(v, limit, now, tier)
    const paceV = v === 'five' && u.five && fresh === 'ok' ? PACE_VIEW[paceState.level] : null
    const temp = temperature(last, ctxFilled, now)
    const dim = fresh !== 'ok'

    const cells = BAR_CELLS[tier]
    const shown = f.from + (f.to - f.from) * (1 - Math.pow(1 - Math.min(1, Math.max(0, (now - f.at) / FILL_MS)), 3))
    const filled = Math.max(0, Math.min(cells, Math.round((shown / 100) * cells)))
    const bar = cells && limit ? (
      Svg ? (
        <Svg source={barSvg(f, cells)} alt={`${t.label}: ${t.pct} usado`} />
      ) : (
        <Text dimColor={dim}>
          <Text color={themeTint(shown)}>{'━'.repeat(filled)}</Text>
          <Text color="subtle">{'─'.repeat(cells - filled)}</Text>
        </Text>
      )
    ) : null

    // Um botão só: clicar troca 5 h ⇄ semana, sem mexer no resto.
    const usageButton = (
      <Button key="usage" plain onPress={() => toggleView($)}>
        <Text color="inactive" size="footnote">{t.label} </Text>
        <Text weight="semibold" tabular dimColor={dim}>{t.pct}</Text>
        {paceV && paceV.glyph ? <Text color={paceV.color}> {paceV.glyph}</Text> : null}
        {FRESH_GLYPH[fresh].glyph ? <Text color={FRESH_GLYPH[fresh].color}> {FRESH_GLYPH[fresh].glyph}</Text> : null}
        {t.renew ? <Text color="inactive" tabular>{tier === 'narrow' ? `  ${t.renew}` : ` · ${t.renew}`}</Text> : null}
      </Button>
    )

    const cache = (
      <Box flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
        {Svg ? (
          <Svg source={dotSvg(temp, working)} alt={`Estado do cache: ${temp.label}`} />
        ) : (
          <Text color={temp.color} dimColor={working && beat}>{temp.glyph}</Text>
        )}
        {tier === 'wide' ? <Text color={temp.color} weight="semibold">{temp.label}</Text> : null}
      </Box>
    )

    return (
      <Box flexDirection="row" flexWrap="nowrap" justifyContent="space-between" alignItems="center" paddingX={1} width="100%">
        <Box flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
          {bar}
          {usageButton}
        </Box>
        {cache}
      </Box>
    )
  })
}
