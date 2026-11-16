import { TERMINAL_MULTIPLEX_RECOVERY_SCROLLBACK_ROWS } from '../../../../../shared/terminal/stream/terminal-multiplex-flow-control'
import { drainTerminalMultiplexRoundRobin } from '../../terminal-multiplex-round-robin'
import {
  sendSnapshotFrames,
  serializeBudgetedRequestedSnapshot
} from './terminal-snapshot-publication'
import {
  isMultiplexStreamAttached,
  type TerminalMultiplexConnection
} from './terminal-multiplex-connection'
import type { TerminalMultiplexStream } from './terminal-stream-types'
import {
  ackLinkHasRoomForHistory,
  creditAckWindow,
  releaseAckPendingHoldbackIfDrained
} from './terminal-multiplex-ack-window'
import { notePausedOutputDropped } from './terminal-multiplex-paused-output-drop'
import type { TerminalOutputFrameChunk } from '../../terminal-output-frame-chunks'
import {
  answerUndeliveredYieldedQueries,
  markYieldedQueriesDiscardedInFrames,
  replaySnapshotCoveredStatelessQueries
} from './terminal-multiplex-yielded-queries'
import {
  prepareTerminalSourceRangeSnapshot,
  type TerminalSourceRangeSnapshotPublication
} from './terminal-source-range-snapshot'

export function installMultiplexFlowControl(state: TerminalMultiplexConnection): void {
  const { runtime, streams } = state
  const linkHasRoomForHistory = (stream: TerminalMultiplexStream): boolean =>
    ackLinkHasRoomForHistory(state, stream)
  state.sendAckRecoverySnapshot = async (stream: TerminalMultiplexStream): Promise<void> => {
    if (
      !isMultiplexStreamAttached(state, stream) ||
      stream.outputPaused ||
      stream.ackRecoverySnapshotInFlight ||
      // Images bypass ACK windows, so one per drained window keeps a slow link from queueing them without bound.
      stream.ackRecoveryAwaitedBytes > 0
    ) {
      return
    }
    stream.ackRecoverySnapshotInFlight = true
    let sourceReplacement: TerminalSourceRangeSnapshotPublication | null = null
    try {
      // Replace client history after dropped output; its retained history no longer reaches this screen.
      const carriesHistory = linkHasRoomForHistory(stream)
      const serialized = await serializeBudgetedRequestedSnapshot(
        runtime,
        stream.ptyId,
        carriesHistory ? TERMINAL_MULTIPLEX_RECOVERY_SCROLLBACK_ROWS : 0
      )
      if (!isMultiplexStreamAttached(state, stream) || stream.outputPaused) {
        return
      }
      if (!serialized) {
        throw new Error('Remote terminal recovery snapshot unavailable.')
      }
      // Overflow still queues, so batched covered output reaches the cutoff below instead of settling queries the viewer drops.
      stream.outputBatcher.flush()
      sourceReplacement = prepareTerminalSourceRangeSnapshot(
        state,
        stream,
        serialized,
        'ack-pending-overflow'
      )
      const displayMode = runtime.getMobileDisplayMode(stream.ptyId)
      const publication = sendSnapshotFrames(
        (opcode, payload) =>
          isMultiplexStreamAttached(state, stream) &&
          state.sendFrame(stream.streamId, opcode, payload),
        {
          kind: 'scrollback',
          cols: serialized.cols,
          rows: serialized.rows,
          displayMode,
          reason: 'ack-pending-overflow',
          seq: serialized.seq,
          source: serialized.source,
          kittyKeyboardFlags: serialized.kittyKeyboardFlags,
          alternateScreen: serialized.alternateScreen,
          terminalOwner: serialized.terminalOwner,
          lastTitle: serialized.lastTitle,
          truncatedByByteBudget: serialized.truncatedByByteBudget,
          scrollbackRows: serialized.scrollbackRows,
          data: serialized.data
        }
      )
      if (!publication.published) {
        throw new Error('Remote terminal recovery snapshot was not published.')
      }
      stream.ackRecoveryAwaitedBytes = stream.ackInFlightBytes
      if (state.linkEstimate.enabled) {
        state.linkEstimate.noteImageSent(publication.bytes)
      }
      if (!isMultiplexStreamAttached(state, stream)) {
        throw new Error('Remote terminal recovery snapshot stream detached.')
      }
      sourceReplacement?.commit(publication.published)
      if (typeof serialized.seq === 'number') {
        const snapshotSeq = serialized.seq
        const isCovered = (chunk: TerminalOutputFrameChunk): boolean =>
          typeof chunk.seq === 'number' && chunk.seq <= snapshotSeq
        markYieldedQueriesDiscardedInFrames(stream, stream.ackPendingOutput.filter(isCovered))
        const retained = stream.ackPendingOutput.filter((chunk) => !isCovered(chunk))
        stream.ackPendingOutput = retained
        stream.ackPendingOutputBytes = retained.reduce(
          (total, chunk) => total + chunk.bytes.byteLength,
          0
        )
        releaseAckPendingHoldbackIfDrained(state, stream)
      }
      stream.ackPendingOutputOverflowed = false
      stream.ackRecoveryHistoryOwed = !carriesHistory
      replaySnapshotCoveredStatelessQueries(state, stream, [], serialized.seq)
    } catch (error) {
      sourceReplacement?.rollback()
      if (!isMultiplexStreamAttached(state, stream)) {
        return
      }
      state.sendStreamError(
        stream.streamId,
        error instanceof Error ? error.message : 'Remote terminal recovery snapshot failed.'
      )
      state.detachStream(stream.streamId, 'unverifiable')
    } finally {
      if (streams.get(stream.streamId) === stream) {
        stream.ackRecoverySnapshotInFlight = false
        state.flushAllAckPendingOutput()
      }
    }
  }
  state.flushAckPendingOutput = (
    stream: TerminalMultiplexStream,
    maxChunks = Number.POSITIVE_INFINITY
  ): number => {
    if (stream.outputPaused) {
      return 0
    }
    if (stream.ackPendingOutputOverflowed) {
      void state.sendAckRecoverySnapshot(stream)
      return 0
    }
    let flushed = 0
    while (
      flushed < stream.ackPendingOutput.length &&
      flushed < maxChunks &&
      state.canSendAckGatedOutput(stream, stream.ackPendingOutput[flushed]!.bytes.byteLength)
    ) {
      if (!state.sendAckGatedOutput(stream, stream.ackPendingOutput[flushed]!, true)) {
        return flushed
      }
      flushed += 1
    }
    if (flushed > 0) {
      stream.ackPendingOutput.splice(0, flushed)
      stream.ackPendingOutputBytes = stream.ackPendingOutput.reduce(
        (total, pending) => total + pending.bytes.byteLength,
        0
      )
    }
    releaseAckPendingHoldbackIfDrained(state, stream)
    if (
      stream.ackRecoveryHistoryOwed &&
      stream.ackPendingOutput.length === 0 &&
      // Flagging overflow while the gate holds the image would queue live output (echo) behind it.
      stream.ackRecoveryAwaitedBytes === 0 &&
      linkHasRoomForHistory(stream)
    ) {
      // The flood settled: one recovery now replaces the screen-only image and its history.
      stream.ackPendingOutputOverflowed = true
      void state.sendAckRecoverySnapshot(stream)
    }
    return flushed
  }
  state.flushAllAckPendingOutput = (): void => {
    const ordered = Array.from(streams.values())
    state.ackFlushCursorStreamId = drainTerminalMultiplexRoundRobin({
      streams: ordered,
      cursorStreamId: state.ackFlushCursorStreamId,
      canContinue: () => !state.closed,
      drainOne: (stream) => {
        if (streams.get(stream.streamId) !== stream) {
          return false
        }
        if (state.flushAckPendingOutput(stream, 1) > 0) {
          return true
        }
        return false
      }
    })
  }
  state.acknowledgeOutput = (stream: TerminalMultiplexStream, bytes: number): void => {
    if (!stream.ackOutput || bytes <= 0) {
      return
    }
    const acknowledged = creditAckWindow(state, stream, bytes)
    if (state.linkEstimate.enabled) {
      state.linkEstimate.noteAcknowledged(stream, acknowledged)
    }
    state.flushAllAckPendingOutput()
    if (stream.ackPendingOutput.length === 0 && !stream.ackPendingOutputOverflowed) {
      stream.ackOutputWaited = false
    }
  }
  state.acknowledgeSourceRanges = (stream, generation, ackedEndByte): void => {
    if (!stream.ackOutputSourceRanges) {
      return
    }
    const result = stream.sourceRangeLedger?.acknowledge(generation, ackedEndByte)
    if (result?.status !== 'accepted') {
      return
    }
    if (result.settled.length > 0) {
      runtime.settleRemoteTerminalSourceRanges(
        {
          ptyId: stream.ptyId,
          consumerId: stream.remoteDesktopSubscriptionKey,
          streamGeneration: stream.streamGeneration
        },
        result.settled
      )
    }
    state.acknowledgeOutput(stream, result.acknowledgedBytes)
  }
  state.detachSourceRangeConsumer = (stream, reason): void => {
    const wasAttached = stream.sourceRangeConsumerAttached
    stream.sourceRangeConsumerAttached = false
    const ledger = stream.sourceRangeLedger
    stream.sourceRangeLedger = null
    if (!ledger) {
      return
    }
    const transfer = ledger.beginTransfer()
    try {
      if (wasAttached) {
        runtime.cancelRemoteTerminalSourceRanges(
          {
            ptyId: stream.ptyId,
            consumerId: stream.remoteDesktopSubscriptionKey,
            streamGeneration: stream.streamGeneration
          },
          transfer.frames.flatMap((frame) => frame.sourceRanges),
          reason
        )
      }
    } finally {
      transfer.commit()
    }
  }
  state.setOutputPaused = (stream, paused): void => {
    if (paused) {
      // Deliver queries whose reply authority was already yielded to this view.
      stream.outputBatcher.flush()
    }
    stream.outputPaused = paused
    if (stream.ackOutputSourceRanges) {
      const identity = {
        ptyId: stream.ptyId,
        consumerId: stream.remoteDesktopSubscriptionKey,
        streamGeneration: stream.streamGeneration
      }
      if (stream.outputPaused) {
        runtime.cancelRemoteTerminalSourceRanges(identity, [], 'output-paused')
        stream.sourceRangeConsumerAttached = false
        stream.sourceRangeLedger?.cancelSourceRanges()
      } else {
        stream.sourceRangeConsumerAttached =
          runtime.attachRemoteTerminalSourceRangeConsumer(identity)
        if (!stream.sourceRangeConsumerAttached) {
          state.detachStream(stream.streamId, 'unverifiable')
          return
        }
      }
    }
    if (stream.outputPaused) {
      stream.pausedOutputDropNoticeSent = false
      const discardsQueuedOutput =
        stream.ackPendingOutput.length > 0 || stream.ackPendingOutputOverflowed
      stream.ackPendingOutput = []
      stream.ackPendingOutputBytes = 0
      stream.ackPendingOutputOverflowed = false
      // Resumed output starts a new backlog; a stale label would seed slow rate samples.
      stream.ackOutputWaited = false
      releaseAckPendingHoldbackIfDrained(state, stream)
      answerUndeliveredYieldedQueries(runtime, stream)
      if (discardsQueuedOutput) {
        notePausedOutputDropped(state, stream)
      }
    }
  }
}
