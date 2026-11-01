export type Limit = { percentUsed: number; resetsAt?: string }
export type Usage = { five: Limit | null; week: Limit | null }

declare module 'claude-code' {
  interface PluginState {
    'usage-band': { usage: Usage; tick: number }
  }
}
