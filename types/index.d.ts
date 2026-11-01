export type Limit = { percentUsed: number; resetsAt?: string }
export type Usage = { five: Limit | null; week: Limit | null }
export type Fill = { from: number; to: number; at: number }

declare module 'claude-code' {
  interface PluginState {
    'usage-band': {
      usage: Usage
      hasContext: boolean
      lastReply: number | null
      tick: number
      fill: Fill
      pulse: boolean
      slot: number
    }
  }
}
