import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit, SessionUsage, Timer } from 'claude-code'

import type { Fill, Limit, Usage } from '../types'

// ---------- estado ----------

const usage = atom({ plugin: 'usage-band', key: 'usage' } as const, { five: null, week: null } as Usage)
const hasContext = atom({ plugin: 'usage-band', key: 'hasContext' } as const, false)
const lastReply = atom({ plugin: 'usage-band', key: 'lastReply' } as const, null as number | null)
const tick = atom({ plugin: 'usage-band', key: 'tick' } as const, 0)
const fill = atom({ plugin: 'usage-band', key: 'fill' } as const, { from: 0, to: 0, at: 0 } as Fill)
const pulse = atom({ plugin: 'usage-band', key: 'pulse' } as const, false)
const slot = atom({ plugin: 'usage-band', key: 'slot' } as const, 0)

// ---------- constantes ----------

const MIN = 60_000
const WINDOW_MS = 5 * 60 * MIN
// O cache de prompt do Claude Code (assinatura) dura 1 h depois da última resposta.
const CACHE_MIN = 60
const WARM_FROM_MIN = 45
const FILL_MS = 900

// Paleta do sistema da Apple (modo escuro, legível no claro).
const BLUE = '#0A84FF'
const AMBER = '#FF9F0A'
const RED = '#FF453A'
const NEON_RED = '#FF375F'
const YELLOW = '#FFD60A'
const ICE = '#64D2FF'
const GRAY = '#8E8E93'

// ---------- utilitários ----------

const pick = (limits: SessionRateLimit[], kind: string): Limit | null => {
  const l = limits.find(x => x.kind === kind)
  return l ? { percentUsed: l.percentUsed, resetsAt: l.resetsAt } : null
}

const fmtDuration = (min: number): string => {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m} min`
  if (h >= 24) return `${Math.floor(h / 24)} d`
  return m === 0 ? `${h} h` : `${h} h ${m}`
}

const minutesUntil = (iso: string | undefined, now: number): number | null => {
  if (!iso) return null
  const ms = Date.parse(iso) - now
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / MIN)) : null
}

const clockTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

const weekday = (iso: string): string =>
  new Date(iso).toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')

const barColor = (pct: number) => (pct >= 90 ? RED : pct >= 75 ? AMBER : BLUE)
const themeTint = (pct: number) => (pct >= 90 ? 'error' : pct >= 75 ? 'warning' : 'suggestion')

// Ritmo: no passo atual, a janela de 5 h acaba antes de renovar?
type Pace = { over: boolean; minutesToLimit: number | null }
const pace = (five: Limit, now: number): Pace | null => {
  const left = five.resetsAt ? Date.parse(five.resetsAt) - now : NaN
  if (!Number.isFinite(left)) return null
  const elapsed = WINDOW_MS - left
  if (elapsed < WINDOW_MS * 0.1 || five.percentUsed < 10) return null
  const perMs = five.percentUsed / elapsed
  const msToLimit = (100 - five.percentUsed) / perMs
  const over = msToLimit < left
  return { over, minutesToLimit: over ? Math.max(1, Math.round(msToLimit / MIN)) : null }
}

type Temp = { kind: 'hot' | 'warm' | 'cold' | 'new'; label: string; color: string; theme: string }
const temperature = (last: number | null, ctx: boolean, now: number): Temp => {
  const cold: Temp = { kind: 'cold', label: 'Frio', color: ICE, theme: 'suggestion' }
  if (last === null) return ctx ? cold : { kind: 'new', label: 'Novo', color: GRAY, theme: 'inactive' }
  const age = (now - last) / MIN
  if (age < WARM_FROM_MIN) return { kind: 'hot', label: 'Quente', color: NEON_RED, theme: 'error' }
  if (age < CACHE_MIN) return { kind: 'warm', label: 'Morno', color: YELLOW, theme: 'warning' }
  return cold
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
const fillAt = (f: Fill, now: number) =>
  f.from + (f.to - f.from) * easeOut(Math.min(1, Math.max(0, (now - f.at) / FILL_MS)))

// ---------- SVG (app desktop, VS Code, celular) ----------

const barSvg = (f: Fill, w: number) => {
  const W = w
  const from = (Math.min(100, f.from) / 100) * W
  const to = (Math.min(100, f.to) / 100) * W
  const c0 = barColor(f.from)
  const c1 = barColor(f.to)
  const moving = from !== to
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="6" viewBox="0 0 ${W} 6">
<rect x="0" y="1" width="${W}" height="4" rx="2" fill="${GRAY}" fill-opacity="0.28"/>
<rect x="0" y="1" width="${to}" height="4" rx="2" fill="${c1}">${
    moving
      ? `<animate attributeName="width" from="${from}" to="${to}" dur="${FILL_MS}ms" calcMode="spline" keySplines="0.2 0.8 0.2 1" keyTimes="0;1" fill="freeze"/>` +
        (c0 !== c1 ? `<animate attributeName="fill" from="${c0}" to="${c1}" dur="${FILL_MS}ms" fill="freeze"/>` : '')
      : ''
  }</rect></svg>`
}

const dotSvg = (t: Temp, working: boolean) => {
  const glow = t.kind === 'hot'
    ? `<defs><filter id="g" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`
    : ''
  // Trabalhando: um anel se expande e some, como o indicador de gravação do iPhone.
  const ripple = working
    ? `<circle cx="9" cy="9" r="4" fill="none" stroke="${t.color}" stroke-width="1.4">
<animate attributeName="r" values="4;8" dur="1.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.2 0.8 0.2 1" keyTimes="0;1"/>
<animate attributeName="stroke-opacity" values="0.8;0" dur="1.6s" repeatCount="indefinite"/></circle>`
    : ''
  // Morno: uma piscada curta de tempos em tempos, lembrando que está esfriando.
  const breathe = working
    ? `<animate attributeName="opacity" values="1;0.55;1" dur="1.6s" repeatCount="indefinite"/>`
    : t.kind === 'warm'
      ? `<animate attributeName="opacity" values="1;1;0.3;1" keyTimes="0;0.9;0.95;1" dur="6s" repeatCount="indefinite"/>`
      : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">${glow}${ripple}
<circle cx="9" cy="9" r="4" fill="${t.color}"${t.kind === 'hot' ? ' filter="url(#g)"' : ''}>${breathe}</circle></svg>`
}

// ---------- funções com $ ----------

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

// Só avisa no que importa, uma vez por janela.
async function checkAlerts($: EngineInterface, u: Usage) {
  const now = await $.clock.now()
  const f = u.five
  if (f) {
    const w = f.resetsAt ?? 'sem-data'
    const left = minutesUntil(f.resetsAt, now)
    const renew = left !== null ? ` Renova em ${fmtDuration(left)}.` : ''
    if (f.percentUsed >= 100) {
      await alertOnce($, `alert:five100:${w}`, `Limite de 5 h atingido.${renew}`)
    } else if (f.percentUsed >= 90) {
      await alertOnce($, `alert:five90:${w}`, `Você usou ${Math.round(f.percentUsed)}% das 5 h.${renew}`)
    } else if (f.percentUsed >= 60) {
      const p = pace(f, now)
      if (p?.over && p.minutesToLimit !== null) {
        await alertOnce($, `alert:pace:${w}`, `No ritmo atual, as 5 h acabam em ~${fmtDuration(p.minutesToLimit)}.${renew}`)
      }
    }
  }
  const wk = u.week
  if (wk && wk.percentUsed >= 80) {
    const w = wk.resetsAt ?? 'sem-data'
    const level = wk.percentUsed >= 95 ? 95 : 80
    const when = wk.resetsAt ? ` Renova ${weekday(wk.resetsAt)} às ${clockTime(wk.resetsAt)}.` : ''
    await alertOnce($, `alert:week${level}:${w}`, `Você usou ${Math.round(wk.percentUsed)}% do limite semanal.${when}`)
  }
}

let fillTimer: Timer | null = null
let pulseTimer: Timer | null = null

async function absorb($: EngineInterface, u: Pick<SessionUsage, 'rateLimits' | 'context'>) {
  const next: Usage = { five: pick(u.rateLimits, 'five_hour'), week: pick(u.rateLimits, 'seven_day') }
  await update($, usage, () => next)
  await update($, hasContext, () => (u.context.tokens ?? 0) > 0)

  const target = next.five?.percentUsed ?? 0
  const now = await $.clock.now()
  const cur = await read($, fill)
  if (target !== cur.to) {
    // A barra parte de onde estava e enche até o valor novo.
    await update($, fill, f => ({ from: fillAt(f, now), to: target, at: now }))
    fillTimer?.cancel()
    const started = now
    fillTimer = $.clock.every(50, async () => {
      await update($, tick, n => n + 1)
      if ((await $.clock.now()) - started > FILL_MS) {
        fillTimer?.cancel()
        fillTimer = null
        await update($, fill, f => ({ ...f, from: f.to }))
      }
    })
  }
  await checkAlerts($, next)
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

// ---------- registro ----------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    try {
      await absorb($, await $.session.usage())
      const saved = await $.store.get(await storeKey($))
      if (typeof saved === 'number') await update($, lastReply, cur => cur ?? saved)
    } catch {}
    $.clock.every(MIN, () => update($, tick, n => n + 1))
    return result
  })

  on('session.measure', async ($, e, next) => {
    await absorb($, e)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await startPulse($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if ((e as { agentId?: string }).agentId === undefined) {
      await markReply($)
      await stopPulse($)
    }
    return next(e)
  })

  // ---------- desenho: uma linha só ----------

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const [u, ctxFilled, last, f, beat, slotIdx] = await Promise.all([
      read($, usage), read($, hasContext), read($, lastReply), read($, fill), read($, pulse), read($, slot),
    ])
    await read($, tick)
    const now = await $.clock.now()
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    // O terminal não desenha SVG: lá a barra e a bolinha são texto.
    const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : null

    const working = e.props.isWorking
    const compact = e.props.bodyColumns < 72
    const temp = temperature(last, ctxFilled, now)
    const five = u.five
    const week = u.week
    const label = (s: string) => <Text color="inactive" size="footnote">{s}</Text>

    // Bloco 1: 5 h, barra, porcentagem e ritmo.
    const p = five ? pace(five, now) : null
    const shown = fillAt(f, now)
    const cellsN = compact ? 8 : 12
    const filled = Math.max(0, Math.min(cellsN, Math.round((shown / 100) * cellsN)))
    const usageBlock = five ? (
      <Box flexDirection="row" alignItems="center" columnGap={1}>
        {label('5 h')}
        {Svg ? (
          <Svg source={barSvg(f, compact ? 64 : 96)} alt={`${Math.round(five.percentUsed)}% da janela de 5 h`} />
        ) : (
          <Text>
            <Text color={themeTint(shown)}>{'━'.repeat(filled)}</Text>
            <Text color="subtle">{'─'.repeat(cellsN - filled)}</Text>
          </Text>
        )}
        <Text weight="semibold" tabular>{Math.round(five.percentUsed)}%</Text>
        {p ? <Text color={p.over ? AMBER : 'inactive'}>{p.over ? '↗' : '→'}</Text> : null}
      </Box>
    ) : (
      <Text color="inactive" size="footnote">Uso aparece após a próxima resposta</Text>
    )

    // Bloco 2: um toque alterna entre as informações.
    const slots: string[] = []
    const left = five ? minutesUntil(five.resetsAt, now) : null
    if (left !== null) slots.push(compact ? `↻ ${fmtDuration(left)}` : `Renova em ${fmtDuration(left)}`)
    if (five?.resetsAt) slots.push(compact ? `↻ ${clockTime(five.resetsAt)}` : `Renova às ${clockTime(five.resetsAt)}`)
    if (p?.over && p.minutesToLimit !== null) slots.push(`Acaba em ~${fmtDuration(p.minutesToLimit)}`)
    if (week?.resetsAt) slots.push(`Semana renova ${weekday(week.resetsAt)}`)
    const slotText = slots.length ? slots[slotIdx % slots.length] : null
    const slotBlock = slotText ? (
      <Button
        key="slot"
        plain
        dimColor
        label={slotText}
        onPress={() => update($, slot, n => n + 1)}
      />
    ) : null

    // Bloco 3: semana.
    const weekBlock = week ? (
      <Text>
        {label(compact ? 'Sem. ' : 'Semana ')}
        <Text color={week.percentUsed >= 90 ? 'error' : week.percentUsed >= 75 ? 'warning' : 'text'} weight="semibold" tabular>
          {Math.round(week.percentUsed)}%
        </Text>
      </Text>
    ) : null

    // Bloco 4: bolinha viva.
    const dotBlock = (
      <Box flexDirection="row" alignItems="center" columnGap={1}>
        {Svg ? (
          <Svg source={dotSvg(temp, working)} alt={working ? `${temp.label}, trabalhando` : temp.label} />
        ) : (
          <Text color={temp.color} dimColor={working && beat}>●</Text>
        )}
        <Text color={temp.color} weight="semibold">{temp.label}</Text>
      </Box>
    )

    return (
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" paddingX={1} width="100%">
        {usageBlock}
        {slotBlock}
        {weekBlock}
        {dotBlock}
      </Box>
    )
  })
}
