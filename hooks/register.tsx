import { atom, read, update } from 'claude-code'
import type { Register, SessionRateLimit } from 'claude-code'

import type { Limit, Usage } from '../types'

const usage = atom({ plugin: 'usage-band', key: 'usage' } as const, { five: null, week: null } as Usage)
const tick = atom({ plugin: 'usage-band', key: 'tick' } as const, 0)

const pick = (limits: SessionRateLimit[], kind: string): Limit | null => {
  const l = limits.find(x => x.kind === kind)
  return l ? { percentUsed: l.percentUsed, resetsAt: l.resetsAt } : null
}

const untilReset = (resetsAt: string | undefined, now: number): string | null => {
  if (!resetsAt) return null
  const ms = Date.parse(resetsAt) - now
  if (!(ms > 0)) return 'agora'
  const min = Math.ceil(ms / 60000)
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

// Barra fina: preenchido na cor de destaque, trilho em tom sutil.
const BAR = 14
const filledCells = (pct: number) => Math.max(0, Math.min(BAR, Math.round((pct / 100) * BAR)))

// Azul sereno no dia a dia; âmbar e vermelho só quando importa.
const tint = (pct: number) => (pct >= 90 ? 'error' : pct >= 75 ? 'warning' : 'suggestion')

export const register: Register = on => {

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    try {
      const u = await $.session.usage()
      await update($, usage, () => ({ five: pick(u.rateLimits, 'five_hour'), week: pick(u.rateLimits, 'seven_day') }))
    } catch {}
    // redesenha a cada minuto para a contagem regressiva andar
    $.clock.every(60_000, () => update($, tick, n => n + 1))
    return result
  })

  on('session.measure', async ($, e, next) => {
    await update($, usage, () => ({ five: pick(e.rateLimits, 'five_hour'), week: pick(e.rateLimits, 'seven_day') }))
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const u = await read($, usage)
    await read($, tick)
    const { Box, Text } = $.ui.resolve(e)

    if (!u.five && !u.week) {
      return (
        <Box paddingX={1}>
          <Text color="inactive" size="footnote">Uso do plano aparece após a próxima resposta</Text>
        </Box>
      )
    }

    const now = await $.clock.now()
    const five = u.five
    const week = u.week
    const reset = five ? untilReset(five.resetsAt, now) : null

    return (
      <Box flexDirection="row" columnGap={3} paddingX={1}>
        {five ? (
          <Text>
            <Text color="inactive" size="footnote">5 h  </Text>
            <Text color={tint(five.percentUsed)}>{'━'.repeat(filledCells(five.percentUsed))}</Text>
            <Text color="subtle">{'─'.repeat(BAR - filledCells(five.percentUsed))}</Text>
            <Text weight="semibold" tabular>  {Math.round(five.percentUsed)}%</Text>
          </Text>
        ) : null}
        {reset ? (
          <Text color="inactive" size="footnote" tabular>
            Renova em {reset}
          </Text>
        ) : null}
        {week ? (
          <Text>
            <Text color="inactive" size="footnote">Semana  </Text>
            <Text color={week.percentUsed >= 90 ? 'error' : week.percentUsed >= 75 ? 'warning' : 'text'} tabular>
              {Math.round(week.percentUsed)}%
            </Text>
          </Text>
        ) : null}
      </Box>
    )
  })
}
