export type Limit = { percentUsed: number; resetsAt?: string }
export type Usage = { five: Limit | null; week: Limit | null }
export type Ctx = { percent: number | null; tokens: number | null }

declare module 'claude-code' {
  interface PluginState {
    'usage-band': { usage: Usage; tick: number; ctx: Ctx; lastReply: number | null }
  }
}
