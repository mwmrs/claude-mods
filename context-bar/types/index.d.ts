export type CacheTtl = '5m' | '1h'

export type ContextFill = {
  /** Fill of the model's window in percent; null until a response reported one. */
  percent: number | null
  /** The auto-compact threshold in percent of the same window. */
  thresholdPercent: number
  /** False while the threshold is the 83 % fallback. */
  isThresholdRead: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'context-bar': {
      lastAt: number | null
      ttl: CacheTtl | null
      hitRate: number | null
      context: ContextFill
      isCollapsed: boolean
      tick: number
    }
  }
}
