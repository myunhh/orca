import { expect, it } from 'vitest'
import type { TerminalOutputSourceRange } from '../../../shared/terminal-output-source-range'
import { TerminalSourceRangeLedger } from './terminal-source-range-ledger'

function sourceRange(start = 0): TerminalOutputSourceRange {
  return {
    id: 'pty-source',
    spanId: `span-${start}`,
    providerGeneration: 1,
    clientGeneration: 2,
    ownerGeneration: 3,
    ptyIncarnation: 'incarnation',
    deliveryToken: 'token',
    sourceStartSu: start,
    sourceEndSu: start + 4,
    displayStart: start,
    displayEnd: start + 4,
    splittable: true,
    transform: { transformed: false, rawLengthSu: 4, scalarSafe: true }
  }
}

it('rejects stale/excessive ACKs and settles a source frame only after its complete encoded payload', () => {
  const ledger = new TerminalSourceRangeLedger('stream-1')
  ledger.accept(8, 4, [sourceRange()], 4)
  expect(ledger.acknowledge('stream-old', 8)).toEqual({ status: 'stale-generation', settled: [] })
  expect(ledger.acknowledge('stream-1', 9)).toEqual({ status: 'excessive', settled: [] })
  expect(ledger.acknowledge('stream-1', 3)).toEqual({
    status: 'accepted',
    acknowledgedBytes: 3,
    settled: []
  })
  expect(ledger.acknowledge('stream-1', 8)).toMatchObject({
    status: 'accepted',
    acknowledgedBytes: 5,
    settled: [{ spanId: 'span-0', sourceStartSu: 0, sourceEndSu: 4 }]
  })
})

it('preserves byte debt but never settles canceled source ranges when a paused stream resumes after a gap', () => {
  const ledger = new TerminalSourceRangeLedger('stream-1')
  ledger.accept(8, 4, [sourceRange()], 4)
  ledger.cancelSourceRanges()
  expect(ledger.acknowledge('stream-1', 8)).toEqual({
    status: 'accepted',
    acknowledgedBytes: 8,
    settled: []
  })
  ledger.accept(8, 4, [sourceRange(100)], 104)
  expect(ledger.acknowledge('stream-1', 16)).toMatchObject({
    status: 'accepted',
    acknowledgedBytes: 8,
    settled: [{ spanId: 'span-100', sourceStartSu: 100, sourceEndSu: 104 }]
  })
})

it('keeps replayed query bytes outside source obligations without admitting ordinary unmapped live output', () => {
  const ledger = new TerminalSourceRangeLedger('stream-1')
  const replay = ledger.prepareAccept(3, 3, [], 0, true)
  expect(replay.status).toBe('ready')
  if (replay.status !== 'ready') {
    throw new Error('Query replay admission rejected')
  }
  replay.admission.commit()
  ledger.accept(8, 4, [sourceRange()], 4)
  expect(ledger.acknowledge('stream-1', 3)).toEqual({
    status: 'accepted',
    acknowledgedBytes: 3,
    settled: []
  })
  expect(ledger.prepareAccept(3, 3, [], 7)).toEqual({ status: 'invalid' })
  expect(ledger.acknowledge('stream-1', 11)).toMatchObject({
    status: 'accepted',
    acknowledgedBytes: 8,
    settled: [{ spanId: 'span-0', sourceStartSu: 0, sourceEndSu: 4 }]
  })
})
