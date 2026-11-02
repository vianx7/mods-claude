export type Limit = { percentUsed: number; resetsAt?: string }
export type Usage = { five: Limit | null; week: Limit | null }
export type Fill = { from: number; to: number; at: number }
export type PaceLevel = 'calculating' | 'normal' | 'elevated' | 'high'
export type PaceState = { level: PaceLevel; window: string | null }
export type Failure = { at: number; reason: string }
/** Como a renovação aparece: tempo restante ou horário. */
export type RenewMode = 'in' | 'at'

declare module 'claude-code' {
  interface PluginState {
    'usage-band': {
      usage: Usage
      hasContext: boolean
      lastReply: number | null
      lastMeasure: number | null
      failure: Failure | null
      tick: number
      fill: Fill
      pulse: boolean
      pace: PaceState
      renewMode: RenewMode
    }
  }
}
