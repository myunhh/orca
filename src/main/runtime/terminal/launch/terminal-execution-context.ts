import { OrcaRuntimeWithRegisterPty } from '../lifecycle/pty-registration'
import type { TerminalOutputSourceRange } from '../../../../shared/terminal-output-source-range'

export abstract class OrcaRuntimeWithPreparePtyExecutionContext extends OrcaRuntimeWithRegisterPty {
  protected abstract disposeHeadlessTerminal(ptyId: string): void

  protected abstract replaceHeadlessTerminalAfterExecutionContextChange(ptyId: string): void

  abstract onPtyData(
    ptyId: string,
    data: string,
    at: number,
    sequenceChars?: number,
    transformed?: boolean,
    captureModelReceipt?: (completion: Promise<void>) => void,
    sourceRanges?: readonly TerminalOutputSourceRange[]
  ): number
  protected abstract shouldAnswerQueriesForLiveChunk(ptyId: string): boolean
  abstract maybeHydrateHeadlessFromRenderer(ptyId: string): Promise<boolean> | null
  protected abstract trackHeadlessTerminalData(
    ptyId: string,
    data: string,
    outputSequence: number,
    forwardQueryReplies?: boolean
  ): Promise<void>
  /** Arrival-order mode scan: the settled tracker plus any in-flight snapshot capture's. */
  protected scanProviderModeTrackers(ptyId: string, data: string): void {
    this.providerModeTrackersByPtyId.get(ptyId)?.scan(data)
    for (const tracker of this.providerModeSnapshotScansByPtyId.get(ptyId) ?? []) {
      tracker.scan(data)
    }
  }

  acceptPtyDataBounded(
    ptyId: string,
    data: string,
    at: number,
    sequenceChars = data.length,
    transformed = false,
    sourceRanges?: readonly TerminalOutputSourceRange[]
  ): { sequence: number; completion: Promise<void> } {
    let completion: Promise<void> | undefined
    const sequence = this.onPtyData(
      ptyId,
      data,
      at,
      sequenceChars,
      transformed,
      (receipt) => {
        completion = receipt
      },
      sourceRanges
    )
    if (!completion) {
      throw new Error('PTY model admission receipt was not captured')
    }
    return { sequence, completion }
  }

  resetPtyModelAfterMigrationFailure(ptyId: string): void {
    this.providerSnapshotPreferredPtys.add(ptyId)
    this.disposeHeadlessTerminal(ptyId)
  }

  preparePtyExecutionContext(
    ptyId: string,
    wslDistro: string | null,
    options: { resetIncarnation?: boolean; preserveExisting?: boolean } = {}
  ): boolean {
    const pty = this.ptysById.get(ptyId)
    const hadExistingContext = this.wslDistroByPtyId.has(ptyId) || pty !== undefined
    if (options.preserveExisting && hadExistingContext) {
      // Why: attach-time settings are only a fallback; a live PTY's recorded
      // execution namespace remains authoritative until its provider replies.
      return false
    }

    if (options.resetIncarnation) {
      // Why: an explicit new lifecycle supersedes an unidentifiable exit from the reused PTY id.
      this.pendingPtyRegistrationIncarnations.get(ptyId)?.exitedIncarnations.clear()
      this.disposeHeadlessTerminal(ptyId)
      this.osc7ScanTailByPtyId.delete(ptyId)
      this.terminalCwdByPtyId.delete(ptyId)
      this.terminalFileUriHostnameByPtyId.delete(ptyId)
      this.wslDistroByPtyId.delete(ptyId)
    }

    const previous = this.wslDistroByPtyId.get(ptyId) ?? null
    if (wslDistro) {
      this.wslDistroByPtyId.set(ptyId, wslDistro)
    } else {
      this.wslDistroByPtyId.delete(ptyId)
    }
    if (pty) {
      this.terminalIdentity.setPtyWslDistro(pty, wslDistro)
    }
    if (!options.resetIncarnation && previous !== wslDistro && this.headlessTerminals.has(ptyId)) {
      // Why: bytes parsed with two distro namespaces would leave an internally
      // inconsistent CWD; rebuild from the provider's authoritative snapshot.
      this.terminalCwdByPtyId.delete(ptyId)
      this.replaceHeadlessTerminalAfterExecutionContextChange(ptyId)
    }
    return options.resetIncarnation === true || !hadExistingContext || previous !== wslDistro
  }

  /** Arm Command Code from the spawn command; chunks arriving earlier fall back to banner detection. */
  noteTerminalSpawnCommand(ptyId: string, command: string | null | undefined): void {
    const trimmed = typeof command === 'string' ? command.trim() : ''
    if (trimmed.length > 0) {
      this.terminalSpawnCommandsByPtyId.set(ptyId, trimmed)
    }
  }
}
