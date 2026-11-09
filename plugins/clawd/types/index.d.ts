/** Um alerta crucial do Clawd. */
export type Alert = {
  message: string
  corrected: string
  /** Turno que estava rodando quando o alerta saiu (para "Parar e corrigir"). */
  turnId: string | null
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    clawd: {
      alert: Alert | null
      runningTurn: string | null
      thinking: boolean
    }
  }
}
