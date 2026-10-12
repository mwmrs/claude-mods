export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type Reading = {
  limits: Limit[]
  /** When the limits were reported, in `$.clock.now()`'s milliseconds. */
  at: number
  /** True while the limits are an earlier session's, read from the store. */
  isStale: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'usage-bar': {
      reading: Reading | null
      /** The highest warning level (75 or 90) already shown per window kind. */
      warned: Record<string, number>
      isCollapsed: boolean
      tick: number
    }
  }
}
