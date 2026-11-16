import type { TerminalOutputSourceRange } from '../../../../shared/terminal-output-source-range'
import type {
  RemoteTerminalSourceRangeConsumerHooks,
  RemoteTerminalSourceRangeReplacementPublication,
  RemoteTerminalSourceRangeReplacementReservation,
  RemoteTerminalSourceRangeStreamIdentity
} from '../../remote-terminal-source-range-consumer'

export type RuntimeTerminalDataMeta = Readonly<{
  seq?: number
  rawLength?: number
  transformed?: boolean
  cwd?: string
  sourceRanges?: readonly TerminalOutputSourceRange[]
}>

type TerminalDataListener = (data: string, meta?: RuntimeTerminalDataMeta) => void

export class RuntimeTerminalStreamConsumers {
  private readonly dataListeners = new Map<string, Set<TerminalDataListener>>()
  private sourceRangeHooks: RemoteTerminalSourceRangeConsumerHooks | null = null
  private readonly sourceRangeConsumers = new Map<string, RemoteTerminalSourceRangeStreamIdentity>()

  setSourceRangeHooks(hooks: RemoteTerminalSourceRangeConsumerHooks | null): void {
    this.sourceRangeHooks = hooks
    if (hooks) {
      for (const identity of this.sourceRangeConsumers.values()) {
        hooks.attach(identity)
      }
    }
  }

  attachSourceRangeConsumer(identity: RemoteTerminalSourceRangeStreamIdentity): boolean {
    const attached = this.sourceRangeHooks?.attach(identity) ?? false
    if (attached) {
      this.sourceRangeConsumers.set(identity.consumerId, identity)
    }
    return attached
  }

  settleSourceRanges(
    identity: RemoteTerminalSourceRangeStreamIdentity,
    ranges: readonly TerminalOutputSourceRange[]
  ): void {
    this.sourceRangeHooks?.settle(identity, ranges)
  }

  reserveSourceRangeReplacement(
    identity: RemoteTerminalSourceRangeStreamIdentity,
    requiredSeq: number,
    reason: string
  ): RemoteTerminalSourceRangeReplacementReservation | null {
    return this.sourceRangeHooks?.reserveReplacement(identity, requiredSeq, reason) ?? null
  }

  commitSourceRangeReplacement(
    reservation: RemoteTerminalSourceRangeReplacementReservation,
    publication: RemoteTerminalSourceRangeReplacementPublication
  ): boolean {
    return this.sourceRangeHooks?.commitReplacement(reservation, publication) ?? false
  }

  rollbackSourceRangeReplacement(
    reservation: RemoteTerminalSourceRangeReplacementReservation,
    reason: string
  ): boolean {
    return this.sourceRangeHooks?.rollbackReplacement(reservation, reason) ?? false
  }

  cancelSourceRanges(
    identity: RemoteTerminalSourceRangeStreamIdentity,
    ranges: readonly TerminalOutputSourceRange[],
    reason: string
  ): void {
    this.sourceRangeHooks?.cancel(identity, ranges, reason)
    const current = this.sourceRangeConsumers.get(identity.consumerId)
    if (
      current?.streamGeneration === identity.streamGeneration &&
      current.ptyId === identity.ptyId
    ) {
      this.sourceRangeConsumers.delete(identity.consumerId)
    }
  }

  subscribe(ptyId: string, listener: TerminalDataListener): () => void {
    const listeners = this.dataListeners.get(ptyId) ?? new Set<TerminalDataListener>()
    listeners.add(listener)
    this.dataListeners.set(ptyId, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) {
        this.dataListeners.delete(ptyId)
      }
    }
  }

  publish(ptyId: string, data: string, getMeta: () => RuntimeTerminalDataMeta): void {
    const listeners = this.dataListeners.get(ptyId)
    if (!listeners) {
      return
    }
    const meta = getMeta()
    for (const listener of listeners) {
      try {
        listener(data, meta)
      } catch (error) {
        // Why: this hot path avoids a per-chunk closure while preserving listener isolation.
        console.error('[runtime] pty-data listener threw', error)
      }
    }
  }
}
