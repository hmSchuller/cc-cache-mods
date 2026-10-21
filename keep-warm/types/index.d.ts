export type Cache = { warmUntil: number; now: number; keepWarmUntil: number | null }

declare module 'claude-code' {
  interface PluginState {
    'keep-warm': { cache: Cache | null }
  }
}
