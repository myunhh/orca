import { afterEach, expect, it, vi } from 'vitest'
import type { PtyRendererDelivery } from '../session'
import { createPtyIpcSession } from '../session'
import { SshPtyOutputIntake } from '../../ssh-pty-output-intake'
import type { PtySourceCreditAckBatch } from '../../../../shared/pty-source-credit-contract'
import { sendPtyDataToRenderer } from './payload'
import { applyCumulativeAck } from './accounting'

afterEach(() => vi.useRealTimers())

it('credits SSH source only after model parsing and its own renderer bytes, not preceding query copies', async () => {
  vi.useFakeTimers()
  const published: PtySourceCreditAckBatch[] = []
  const model = Promise.withResolvers<void>()
  let sequence = 0
  const session = createPtyIpcSession({
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: this IPC-boundary fixture only receives webContents.send calls.
    mainWindow: { webContents: { send() {} } } as unknown as PtyRendererDelivery
  })
  const intake = new SshPtyOutputIntake({
    getModelSequence: () => sequence,
    acceptModel: (event) => {
      sequence += event.rawLength
      return { sequence, completion: model.promise }
    },
    project: (event, projection) => {
      sendPtyDataToRenderer(
        session,
        event.id,
        {
          id: event.id,
          data: event.data,
          seq: projection.identity.sequenceEnd,
          rawLength: event.rawLength
        },
        [projection.identity.projectionSemanticsId]
      )
    },
    prepareExit: () => {},
    finalizeExit: () => {},
    publishSourceAck: (_generation, batch, settled) => {
      published.push(batch)
      settled({ ok: true })
    }
  })
  session.sshOutputIntake = intake
  try {
    sendPtyDataToRenderer(session, 'pty-source', { id: 'pty-source', data: 'query-copy' })
    const accepted = intake.acceptData({
      id: 'pty-source',
      data: 'abcd',
      rawLength: 4,
      transformed: false,
      providerGeneration: 1,
      ptyIncarnation: 'incarnation',
      source: {
        spanId: 'span',
        clientGeneration: 2,
        ownerGeneration: 3,
        deliveryToken: 'token',
        sourceStartSu: 0,
        sourceEndSu: 4
      }
    })
    model.resolve()
    await accepted
    await vi.runOnlyPendingTimersAsync()
    expect(published).toEqual([])

    applyCumulativeAck(session, 'pty-source', 10)
    await vi.runOnlyPendingTimersAsync()
    expect(published).toEqual([])

    applyCumulativeAck(session, 'pty-source', 14)
    await vi.runOnlyPendingTimersAsync()
    expect(published).toEqual([
      {
        acknowledgements: [
          {
            id: 'pty-source',
            clientGeneration: 2,
            ownerGeneration: 3,
            deliveryToken: 'token',
            creditedEndSu: 4
          }
        ]
      }
    ])
  } finally {
    intake.dispose()
  }
})
