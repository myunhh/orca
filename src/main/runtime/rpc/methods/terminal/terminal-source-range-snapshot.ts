import {
  isMultiplexStreamAttached,
  type TerminalMultiplexConnection
} from './terminal-multiplex-connection'
import type { SerializedSnapshot, TerminalMultiplexStream } from './terminal-stream-types'

export type TerminalSourceRangeSnapshotPublication = {
  commit: (published: boolean) => void
  rollback: () => void
}

/** Snapshot replacement transfers source obligations only after its authoritative image is published. */
export function prepareTerminalSourceRangeSnapshot(
  state: TerminalMultiplexConnection,
  stream: TerminalMultiplexStream,
  snapshot: SerializedSnapshot,
  reason: string
): TerminalSourceRangeSnapshotPublication | null {
  if (!stream.ackOutputSourceRanges || !stream.sourceRangeConsumerAttached) {
    return null
  }
  if (!snapshot?.source || typeof snapshot.seq !== 'number') {
    throw new Error('Remote terminal snapshot source identity unavailable.')
  }
  const source = snapshot.source
  const seq = snapshot.seq
  if (stream.sourceRangeReplacement) {
    throw new Error('Remote terminal source replacement already in progress.')
  }
  const local = stream.sourceRangeLedger?.planSourceRangeReplacement(snapshot.seq)
  if (!local) {
    throw new Error('Remote terminal source ledger replacement unavailable.')
  }
  const reservation = state.runtime.reserveRemoteTerminalSourceRangeReplacement(
    {
      ptyId: stream.ptyId,
      consumerId: stream.remoteDesktopSubscriptionKey,
      streamGeneration: stream.streamGeneration
    },
    snapshot.seq,
    reason
  )
  if (!reservation) {
    throw new Error('Remote terminal source replacement unavailable.')
  }
  stream.sourceRangeReplacement = reservation
  const rollback = (): void => {
    if (stream.sourceRangeReplacement !== reservation) {
      return
    }
    stream.sourceRangeReplacement = null
    state.runtime.rollbackRemoteTerminalSourceRangeReplacement(reservation, `${reason}-unpublished`)
  }
  return {
    commit: (published) => {
      if (
        !published ||
        !isMultiplexStreamAttached(state, stream) ||
        stream.sourceRangeReplacement !== reservation ||
        !state.runtime.commitRemoteTerminalSourceRangeReplacement(reservation, {
          source,
          seq
        })
      ) {
        rollback()
        throw new Error('Remote terminal source replacement was not published.')
      }
      local.commit()
      stream.sourceRangeReplacement = null
    },
    rollback
  }
}
