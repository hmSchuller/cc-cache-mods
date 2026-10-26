import { expect, mock, test } from 'claude-code/testing'

const MIN = 60_000

const setup = async ($: any, on: any) => {
  const clock = mock.clock(on)
  let pings = 0

  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'let-cool' } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('turn.start', (_: unknown, e: any) => e)
  on('turn.step', async function* () {
    return {}
  })
  on('turn.complete', () => ({ text: 'done' }))
  on('model.fork', () => {
    pings += 1

    return {
      value: {
        isAnswered: true,
        text: 'ok',
        usage: { cache_read_input_tokens: 50_000 },
      },
    }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  return { clock, pings: () => pings }
}

const runTurn = async ($: any) => {
  await $.turn.start({ text: 'hi', turnId: 't' })
  await $.turn.complete({ reason: 'answer', turnId: 't', answer: 'hello' })
}

test('keep-warm pings after a turn', async ($, on) => {
  const { clock, pings } = await setup($, on)
  await runTurn($)
  await clock.advance(5 * MIN)

  expect(pings()).toBeGreaterThan(0)
})

test('/let-cool stops the pings', async ($, on) => {
  const { clock, pings } = await setup($, on)
  await runTurn($)
  await $.command.run({ command: 'let-cool', args: '' })
  await clock.advance(20 * MIN)

  expect(pings()).toBe(0)
})

test('the next message resumes keep-warm', async ($, on) => {
  const { clock, pings } = await setup($, on)
  await runTurn($)
  await $.command.run({ command: 'let-cool', args: '' })
  await clock.advance(2 * MIN)
  await runTurn($)
  await clock.advance(5 * MIN)

  expect(pings()).toBeGreaterThan(0)
})
