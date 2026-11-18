export type Limit = { percentUsed: number; resetsAt?: string }
export type Usage = { five: Limit | null; week: Limit | null }
export type Fill = { from: number; to: number; at: number }
/** Nível de ritmo com histerese, ligado à janela de 5 h em que foi calculado. */
export type PaceLevel = 'calculating' | 'normal' | 'elevated' | 'high'
export type PaceState = { level: PaceLevel; window: string | null }
/** Falha de leitura: quando e por quê. */
export type Failure = { at: number; reason: string }

/** Um alerta do Clawd: ocupa a linha inteira enquanto dura. */
export type Alert =
  | { kind: 'fix'; message: string; corrected: string; at: number }
  | {
    /** Conversa grande e fria: o prompt foi segurado antes de reler tudo sem desconto. */
    kind: 'cold'
    message: string
    held: string
    at: number
  }

/** O que fica no histórico do menu do Clawd. */
export type LogEntry = { at: number; text: string }

/**
 * Como a triagem do Clawd roda.
 * - economy: pré-filtro grátis decide se vale chamar o modelo (padrão)
 * - always: todo prompt com 8+ palavras passa pela triagem
 * - free: nunca chama modelo; só os recursos grátis
 */
export type Mode = 'economy' | 'always' | 'free'

export type Stats = { triaged: number; skipped: number; deep: number; alerts: number; coldHolds: number; tokens: number }

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
      pace: PaceState
      focusKey: string | null
      clawdAlert: Alert | null
      runningTurn: string | null
      clawdThinking: boolean
      bypassOnce: boolean
      clawdLog: LogEntry[]
    }
  }
}
