import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit, SessionUsage } from 'claude-code'

import type { Limit, Usage } from '../types'

const usage = atom({ plugin: 'usage-band', key: 'usage' } as const, { five: null, week: null } as Usage)
const lastReply = atom({ plugin: 'usage-band', key: 'lastReply' } as const, null as number | null)
const hasContext = atom({ plugin: 'usage-band', key: 'hasContext' } as const, false)
const tick = atom({ plugin: 'usage-band', key: 'tick' } as const, 0)

// O cache de prompt do Claude Code (assinatura) dura 1 h a partir da última resposta.
// Quente: cache vivo. Morno: vivo, mas expira em breve. Frio: expirado, a próxima
// mensagem relê o contexto inteiro sem desconto.
const CACHE_MIN = 60
const WARM_FROM_MIN = 45

const MIN = 60_000

// ---------- helpers ----------

const pick = (limits: SessionRateLimit[], kind: string): Limit | null => {
  const l = limits.find(x => x.kind === kind)
  return l ? { percentUsed: l.percentUsed, resetsAt: l.resetsAt } : null
}

const fmtDuration = (min: number): string => {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m} min`
  if (h >= 24) return `${Math.floor(h / 24)} d`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

const untilReset = (resetsAt: string | undefined, now: number): string | null => {
  if (!resetsAt) return null
  const ms = Date.parse(resetsAt) - now
  if (!(ms > 0)) return 'agora'
  return fmtDuration(Math.ceil(ms / MIN))
}

// Cores no estilo do sistema da Apple.
const NEON_RED = '#FF375F'
const AMBER = '#FFD60A'
const ICE_BLUE = '#64D2FF'

type Temp = { label: string; color: string; detail: string | null }

const temperature = (last: number | null, hasContext: boolean, now: number): Temp => {
  if (last === null) {
    return hasContext
      ? { label: 'Frio', color: ICE_BLUE, detail: 'cache expirado' }
      : { label: 'Novo', color: 'inactive', detail: null }
  }
  const age = Math.floor((now - last) / MIN)
  if (age < WARM_FROM_MIN) return { label: 'Quente', color: NEON_RED, detail: `esfria em ${fmtDuration(CACHE_MIN - age)}` }
  if (age < CACHE_MIN) return { label: 'Morno', color: AMBER, detail: `esfria em ${fmtDuration(CACHE_MIN - age)}` }
  return { label: 'Frio', color: ICE_BLUE, detail: `há ${fmtDuration(age)}` }
}

const BAR = 12
const cells = (pct: number, width = BAR) => Math.max(0, Math.min(width, Math.round((pct / 100) * width)))
const tint = (pct: number) => (pct >= 90 ? 'error' : pct >= 75 ? 'warning' : 'suggestion')

// ---------- registro ----------

async function storeKey($: EngineInterface) { return `lastReply:${await $.session.id()}` }

async function absorb($: EngineInterface, u: Pick<SessionUsage, 'rateLimits' | 'context'>) {
  await update($, usage, () => ({ five: pick(u.rateLimits, 'five_hour'), week: pick(u.rateLimits, 'seven_day') }))
  await update($, hasContext, () => (u.context.tokens ?? 0) > 0)
}

async function markReply($: EngineInterface) {
  const now = await $.clock.now()
  await update($, lastReply, () => now)
  try {
    await $.store.set(await storeKey($), now)
  } catch {}
}


export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    try {
      await absorb($, await $.session.usage())
      // Retomando uma conversa antiga: recupera quando foi a última resposta.
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

  on('turn.complete', async ($, e, next) => {
    if ((e as { agentId?: string }).agentId === undefined) await markReply($)
    return next(e)
  })

  // ---------- desenho ----------

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const [u, ctxFilled, last] = await Promise.all([read($, usage), read($, hasContext), read($, lastReply)])
    await read($, tick)
    const now = await $.clock.now()
    const { Box, Text } = $.ui.resolve(e)

    const compact = e.props.bodyColumns < 72
    const temp = temperature(last, ctxFilled, now)
    const five = u.five
    const week = u.week
    const reset = five ? untilReset(five.resetsAt, now) : null
    const label = (s: string) => <Text color="inactive" size="footnote">{s}</Text>
    const bar = compact ? 8 : BAR

    const dot = (
      <Text>
        <Text color={temp.color}>● </Text>
        <Text color={temp.color} weight="semibold">{temp.label}</Text>
      </Text>
    )

    // Uma linha só; os itens se distribuem por igual de ponta a ponta.
    return (
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" paddingX={1} width="100%">
        {five ? (
          <Text>
            {label('5 h  ')}
            <Text color={tint(five.percentUsed)}>{'━'.repeat(cells(five.percentUsed, bar))}</Text>
            <Text color="subtle">{'─'.repeat(bar - cells(five.percentUsed, bar))}</Text>
            <Text weight="semibold" tabular>  {Math.round(five.percentUsed)}%</Text>
          </Text>
        ) : (
          <Text color="inactive" size="footnote">Uso aparece após a próxima resposta</Text>
        )}
        {reset ? (
          <Text color="inactive" size="footnote" tabular>{compact ? `↻ ${reset}` : `Renova em ${reset}`}</Text>
        ) : null}
        {week ? (
          <Text>
            {label(compact ? 'Sem.  ' : 'Semana  ')}
            <Text color={week.percentUsed >= 90 ? 'error' : week.percentUsed >= 75 ? 'warning' : 'text'} weight="semibold" tabular>
              {Math.round(week.percentUsed)}%
            </Text>
          </Text>
        ) : null}
        {dot}
      </Box>
    )
  })
}
