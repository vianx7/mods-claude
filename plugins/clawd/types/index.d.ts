/** Um alerta do Clawd na linha acima do prompt. */
export type Alert =
  | {
    kind: 'fix'
    message: string
    corrected: string
    at: number
  }
  | {
    /** Conversa grande e fria: o prompt foi segurado antes de reler tudo sem desconto. */
    kind: 'cold'
    message: string
    held: string
    at: number
  }

/** O que fica no histórico do menu. */
export type LogEntry = { at: number; text: string }

/**
 * Como a triagem roda.
 * - economy: pré-filtro grátis decide se vale chamar o modelo (padrão)
 * - always: todo prompt seu com 8+ palavras passa pela triagem
 * - free: nunca chama modelo; só os recursos grátis (aviso de conversa fria)
 */
export type Mode = 'economy' | 'always' | 'free'

export type Stats = {
  triaged: number
  skipped: number
  deep: number
  alerts: number
  coldHolds: number
  tokens: number
}

declare module 'claude-code' {
  interface PluginState {
    clawd: {
      alert: Alert | null
      runningTurn: string | null
      thinking: boolean
      lastReply: number | null
      bypassOnce: boolean
      log: LogEntry[]
    }
  }
}
