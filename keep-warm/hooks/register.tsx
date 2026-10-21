import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { Cache } from '../types'

// Just under the 5-minute cache TTL, so each ping lands before the entry lapses.
const PING_EVERY_MS = 290_000
// Past this much idle time, one cache rewrite is cheaper than more pings.
const MAX_IDLE_MS = 30 * 60_000
const CACHE_TTL_MS = 5 * 60_000
const PING_PROMPT = 'Keep-alive ping. Reply with exactly: ok'

const cache = atom({ plugin: 'keep-warm', key: 'cache' } as const, null as Cache | null)

const clockText = (ms: number) => {
  const seconds = Math.max(0, Math.ceil(ms / 1000))

  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

type Timer = { cancel: () => void }

type Warm = {
  timer?: Timer
  tick?: Timer
  idleSince: number
  pings: number
  // Thousands of tokens the last ping read from the cache.
  cachedK: number
  // Bumped by each keep-warm start and halt, so a pending ping of a retired run does nothing.
  runs: number
}

const stopTimers = (w: Warm) => {
  w.timer?.cancel()
  w.timer = undefined
  w.tick?.cancel()
  w.tick = undefined
}

// Starts pinging from `anchor`, retiring any run before it.
async function keepWarm($: Engine, w: Warm, anchor: number) {
  const run = ++w.runs
  stopTimers(w)
  w.idleSince = anchor
  w.pings = 0
  await update($, cache, () => ({
    warmUntil: anchor + CACHE_TTL_MS,
    now: anchor,
    keepWarmUntil: anchor + MAX_IDLE_MS,
  }))

  const endKeepWarm = async (status: string) => {
    w.timer?.cancel()
    w.timer = undefined
    $.ui.status(status)
    await update($, cache, c => c && { ...c, keepWarmUntil: null })
  }

  const ping = async () => {
    if (run !== w.runs) {
      return
    }

    if ((await $.clock.now()) - w.idleSince >= MAX_IDLE_MS) {
      await endKeepWarm(`keep-warm: idle ${MAX_IDLE_MS / 60_000}m, stopped after ${w.pings} pings`)

      return
    }

    const sentAt = await $.clock.now()
    const reply = await $.model.fork({ prompt: PING_PROMPT })

    if (run !== w.runs) {
      return
    }

    if (!reply.isAnswered && reply.reason !== 'empty-reply') {
      await endKeepWarm(`keep-warm: stopped (${reply.reason})`)

      return
    }

    w.pings += 1
    const now = await $.clock.now()
    await update($, cache, c => c && { ...c, warmUntil: sentAt + CACHE_TTL_MS, now })
    w.cachedK = Math.round(reply.usage.cache_read_input_tokens / 1000)
    $.ui.status(`keep-warm: ${w.pings} pings, ${w.cachedK}k cached`)
    schedule(sentAt)
  }

  // Each ping lands PING_EVERY_MS after the last request was sent, whenever that was.
  const schedule = (from: number) => {
    void $.clock.now().then(now => {
      if (run === w.runs) {
        w.timer = $.clock.after(Math.max(0, from + PING_EVERY_MS - now), () => void ping())
      }
    })
  }

  // Redraws the countdown each second; once the cache is cold it no longer changes.
  const advance = async () => {
    const now = await $.clock.now()
    await update($, cache, c => c && { ...c, now })
    const c = await read($, cache)

    if (c === null || (c.keepWarmUntil === null && now >= c.warmUntil)) {
      w.tick?.cancel()
      w.tick = undefined
    }
  }

  schedule(anchor)
  w.tick = $.clock.every(1000, () => void advance())
}

// The status line is hidden behind a question or permission dialog, so the transcript records the pings.
async function halt($: Engine, w: Warm) {
  if (w.pings > 0) {
    $.ui.log(`kept the cache warm with ${w.pings} pings, ${w.cachedK}k cached`)
    w.pings = 0
  }

  w.runs += 1
  stopTimers(w)
  $.ui.status(undefined)
  await update($, cache, () => null)
}

export const register: Register = on => {
  const w: Warm = { idleSince: 0, pings: 0, cachedK: 0, runs: 0 }
  // When the main loop last sent a model request; the cache TTL counts from here.
  let lastRequestAt: number | undefined
  // Main-loop tool calls in flight; parallel calls share one keep-warm run.
  let toolsRunning = 0

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      toolsRunning = 0
      await halt($, w)
    }

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      lastRequestAt = await $.clock.now()
    }

    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)

    if (e.agentId === undefined) {
      await keepWarm($, w, lastRequestAt ?? (await $.clock.now()))
    }

    return done
  })

  // A turn waits inside a tool call (a question to the person, a permission prompt, a long
  // tool or subagent) without sending requests, so keep warm there as when the turn is done.
  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) {
      return next(e)
    }

    toolsRunning += 1

    if (toolsRunning === 1) {
      await keepWarm($, w, lastRequestAt ?? (await $.clock.now()))
    }

    try {
      return await next(e)
    } finally {
      toolsRunning -= 1

      if (toolsRunning === 0) {
        await halt($, w)
      }
    }
  })

  on('session.end', ($, e, next) => {
    w.runs += 1
    stopTimers(w)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const c = await read($, cache)

    if (e.props.hasSurvey || e.props.isWorking || c === null) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const left = c.warmUntil - c.now

    if (left <= 0) {
      return (
        <Box justifyContent="flex-end">
          <Text dimColor>🧊 cache cold</Text>
        </Box>
      )
    }

    const [dot, color] =
      left > 3 * 60_000 ? ['🟢', 'success'] : left > 60_000 ? ['🟡', 'warning'] : ['🔴', 'error']

    return (
      <Box justifyContent="flex-end">
        <Text color={color}>
          {dot} ⏳ cache {clockText(left)}
        </Text>
        {c.keepWarmUntil !== null ? (
          <Text dimColor> · keep-warm {clockText(c.keepWarmUntil - c.now)}</Text>
        ) : null}
      </Box>
    )
  })
}
