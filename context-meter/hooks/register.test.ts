import { expect, test } from 'claude-code/testing'

import { contextLevel, recordCall } from './register'

const ZERO = { contextTokens: 0, contextWindow: 200000, expect: null, partial: 0, rewritten: 0, full: 0, level: 0 }
const call = (input: number, cw: number, cr: number) => ({
  input_tokens: input,
  cache_creation_input_tokens: cw,
  cache_read_input_tokens: cr,
})

test('context level follows the 100k / 150k / 200k thresholds', () => {
  expect([99999, 100000, 150000, 200000].map(contextLevel)).toEqual([0, 1, 2, 3])
})

test('counts partial and full cache misses', () => {
  let r = recordCall(ZERO, call(10, 20000, 0)) // first call: nothing expected yet
  expect(r.miss).toBe(null)
  r = recordCall(r.meter, call(10, 1000, 20000)) // read all it should: hit
  expect(r.miss).toBe(null)
  r = recordCall(r.meter, call(10, 5000, 18000)) // expected 21000, read 18000
  expect(r.miss).toEqual({ kind: 'partial', tokens: 3000 })
  r = recordCall(r.meter, call(10, 23000, 0)) // read nothing: full miss
  expect(r.miss).toEqual({ kind: 'full', tokens: 23000 })
  expect([r.meter.partial, r.meter.rewritten, r.meter.full]).toEqual([1, 3000, 1])
  expect(r.meter.contextTokens).toBe(23010)
})

