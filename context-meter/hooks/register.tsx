import { atom, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Meter } from '../types'

const INITIAL: Meter = {
  contextTokens: 0,
  contextWindow: 200000,
  expect: null,
  partial: 0,
  rewritten: 0,
  full: 0,
  level: 0,
}

const meter = atom({ plugin: 'context-meter', key: 'meter' } as const, INITIAL)

// Absolute context size, not a percentage of the window.
const THRESHOLDS = [100000, 150000, 200000]
const LEVEL_HINT = ['', 'Keep an eye on it.', 'Consider compacting soon.', 'Time to compact or start fresh.']

export function contextLevel(tokens: number): number {
  return THRESHOLDS.filter(t => tokens >= t).length
}

export function fmtK(n: number): string {
  if (n >= 999950) return `${(n / 1000000).toFixed(1)}M`
  return n >= 10000 ? `${Math.round(n / 1000)}k` : `${(n / 1000).toFixed(1)}k`
}

export type Miss = { kind: 'partial' | 'full'; tokens: number } | null

// A call should read back what the previous call left in the cache: its read
// should equal the previous read + write. A read of 0 is a full miss, a smaller
// read a partial miss; the shortfall is the number of tokens cached again.
export function recordCall(
  m: Meter,
  usage: { cache_read_input_tokens: number; cache_creation_input_tokens: number; input_tokens: number },
): { meter: Meter; miss: Miss } {
  const cr = usage.cache_read_input_tokens
  const cw = usage.cache_creation_input_tokens
  const next = { ...m, contextTokens: usage.input_tokens + cw + cr }
  let miss: Miss = null
  if (m.expect !== null) {
    if (cr === 0 && m.expect > 0) {
      next.full += 1
      miss = { kind: 'full', tokens: m.expect }
    } else if (cr < m.expect) {
      next.partial += 1
      next.rewritten += m.expect - cr
      miss = { kind: 'partial', tokens: m.expect - cr }
    }
  }
  next.expect = cr + cw
  return { meter: next, miss }
}

export const register: Register = on => {
  // Seed the context fill from what the engine already knows, so a resumed session
  // doesn't re-announce thresholds it is already past. Only crossings announce.
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const { context } = await $.session.usage()
    await update($, meter, m => {
      const contextTokens = context.tokens ?? m.contextTokens
      return { ...m, contextWindow: context.window, contextTokens, level: contextLevel(contextTokens) }
    })
    return result
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    // Subagent calls have their own cache chain; leave them out.
    if (e.agentId !== undefined || !result.usage) return result

    const usage = result.usage
    let miss: Miss = null
    let crossed = 0
    await update($, meter, m => {
      const r = recordCall(m, usage)
      miss = r.miss
      const level = contextLevel(r.meter.contextTokens)
      crossed = level > m.level ? level : 0
      return { ...r.meter, level }
    })

    if (crossed > 0) {
      $.ui.toast(`Context passed ${THRESHOLDS[crossed - 1] / 1000}k. ${LEVEL_HINT[crossed]}`, { timeoutMs: 6000 })
    }
    const m = miss as Miss
    if (m !== null) {
      $.ui.toast(
        m.kind === 'full'
          ? `Cache miss: the whole prompt (${fmtK(m.tokens)}) was cached again.`
          : `Partial cache miss: ${fmtK(m.tokens)} cached again.`,
        { timeoutMs: 6000 },
      )
    }
    return result
  })

  on('session.measure', async ($, e, next) => {
    const { tokens, window } = e.context
    await update($, meter, m => ({ ...m, contextWindow: window, contextTokens: tokens ?? m.contextTokens }))
    return next(e)
  })
}
