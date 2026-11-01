export type Limit = { percentUsed: number; resetsAt?: string }
export type Usage = { five: Limit | null; week: Limit | null }
export type Fill = { from: number; to: number; at: number }
/** Nível de ritmo com histerese, ligado à janela de 5 h em que foi calculado. */
export type PaceLevel = 'calculating' | 'normal' | 'elevated' | 'high'
export type PaceState = { level: PaceLevel; window: string | null }
/** Falha de leitura: quando e por quê. */
export type Failure = { at: number; reason: string }

declare module 'claude-code' {
  interface PluginState {
    'usage-band': {
      usage: Usage
      hasContext: boolean
      ctxPercent: number | null
      lastReply: number | null
      lastMeasure: number | null
      failure: Failure | null
      tick: number
      fill: Fill
      pulse: boolean
      slot: number
      weekSlot: number
      pace: PaceState
      focusKey: string | null
    }
  }
}
