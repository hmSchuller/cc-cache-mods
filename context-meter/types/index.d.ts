export type Meter = {
  /** Input tokens of the last main-thread call (uncached + cache write + cache read). */
  contextTokens: number
  /** The model's context window size. */
  contextWindow: number
  /** What the next call should read from cache: the previous read + write; null before the first call. */
  expect: number | null
  /** Calls that read less than expected, but not zero. */
  partial: number
  /** Tokens that had to be cached again across the partial misses. */
  rewritten: number
  /** Calls that read nothing although something was cached. */
  full: number
  /** The highest threshold (0 none, 1 = 100k, 2 = 150k, 3 = 200k) already announced; drops when context shrinks. */
  level: number
}

declare module 'claude-code' {
  interface PluginState {
    'context-meter': { meter: Meter }
  }
}
