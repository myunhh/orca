import { WORKSPACE_SESSION_DOMAINS } from '../../workspace-session-domains'
import type {
  SshPendingPtyKill,
  SshPendingPtyKillEntry
} from '../../../../shared/ssh-pending-pty-kill'
import type { SshPtyConsumerRecovery, SshRemotePtyLease } from '../../../../shared/ssh-types'
import type { PtyRetirementEvidence } from '../../../pty/process-retirement/pty-exit-proof'
import {
  getSshRemotePtyLeases as getSshRemotePtyLeasesOperation,
  markSshRemotePtyLease as markSshRemotePtyLeaseOperation,
  upsertSshRemotePtyLease as upsertSshRemotePtyLeaseOperation,
  markSshRemotePtyLeases as markSshRemotePtyLeasesOperation,
  markSshRemotePtyLeasesAsync as markSshRemotePtyLeasesAsyncOperation,
  markSshRemotePtyLeasesAttachedAsync as markSshRemotePtyLeasesAttachedAsyncOperation,
  markSshRemotePtyLeasesForShutdown as markSshRemotePtyLeasesForShutdownOperation,
  removeSshRemotePtyLease as removeSshRemotePtyLeaseOperation,
  type SshPtyLeaseUpdate,
  type SshRemotePtyLeaseUpsert,
  type MarkSshRemotePtyLeaseOptions,
  removeSshRemotePtyLeases as removeSshRemotePtyLeasesOperation,
  setSshRemotePtyLeasePendingKill as setSshRemotePtyLeasePendingKillOperation,
  type SshPtyLeaseOperations
} from '../../leasing-ssh-ptys/ssh-pty-lease-operations'
import {
  getSshPtyConsumerRecovery as getSshPtyConsumerRecoveryOperation,
  upsertSshPtyConsumerRecovery as upsertSshPtyConsumerRecoveryOperation,
  removeSshPtyConsumerRecovery as removeSshPtyConsumerRecoveryOperation,
  type SshPtyConsumerRecoveryOperations
} from '../../leasing-ssh-ptys/ssh-pty-consumer-recovery'
import {
  reconcileSshRemotePtyLeasesForTarget as reconcileSshRemotePtyLeasesForTargetOperation,
  supersedeSshRemotePtyLeasesForBoundPane as supersedeSshRemotePtyLeasesForBoundPaneOperation
} from '../../leasing-ssh-ptys/ssh-pty-pane-supersession'
import {
  getSshRemotePtyKillIntents as getSshRemotePtyKillIntentsOperation,
  recordSshRemotePtyKillIntent as recordSshRemotePtyKillIntentOperation,
  clearSshRemotePtyKillIntent as clearSshRemotePtyKillIntentOperation,
  noteSshRemotePtyKillReplayAttempt as noteSshRemotePtyKillReplayAttemptOperation,
  pruneExpiredSshRemotePtyKillIntents as pruneExpiredSshRemotePtyKillIntentsOperation
} from '../../leasing-ssh-ptys/ssh-pty-kill-intent-operations'
import {
  clearSshRemotePtyBindingsForLeases as clearSshRemotePtyBindingsForLeasesOperation,
  clearSshRemotePtyBindingsForTarget as clearSshRemotePtyBindingsForTargetOperation,
  type SshPtyBindingCleanupOperations
} from '../../leasing-ssh-ptys/ssh-pty-binding-cleanup'

import type { DurableProfileStateMutation, StoreRuntimeState } from '../store-runtime-state'
import type { WriteFlushBarrierOperations } from '../profile-writing/write-flush-barriers'
import type { TerminalBindingRecoveryOperations } from '../terminal-bindings/terminal-binding-recovery'
import type { WriteSchedulingOperations } from '../profile-writing/write-scheduling'
import { scheduleSave } from '../profile-writing/write-scheduling'

type SshLeaseRecoveryOperationsRuntime = Pick<
  StoreRuntimeState,
  'dirtyProfileStateDomains' | 'state' | 'protectedSecrets' | 'runDurableMutation'
>

const sshLeaseRecoveryOperationsContext = Symbol('SshLeaseRecoveryOperations')
type SshLeaseRecoveryOperationsContext = {
  runtime: SshLeaseRecoveryOperationsRuntime
  flushBarriers: WriteFlushBarrierOperations
  bindingRecovery: TerminalBindingRecoveryOperations
  scheduling: WriteSchedulingOperations
}

export class SshLeaseRecoveryOperations {
  readonly [sshLeaseRecoveryOperationsContext]: SshLeaseRecoveryOperationsContext

  constructor(
    runtime: SshLeaseRecoveryOperationsRuntime,
    flushBarriers: WriteFlushBarrierOperations,
    bindingRecovery: TerminalBindingRecoveryOperations,
    scheduling: WriteSchedulingOperations
  ) {
    this[sshLeaseRecoveryOperationsContext] = {
      runtime,
      flushBarriers,
      bindingRecovery,
      scheduling
    }
  }

  getSshPtyConsumerRecovery(targetId: string): SshPtyConsumerRecovery | null {
    return getSshPtyConsumerRecoveryOperation(getSshPtyConsumerRecoveryOperations(this), targetId)
  }

  async upsertSshPtyConsumerRecovery(record: SshPtyConsumerRecovery): Promise<void> {
    await upsertSshPtyConsumerRecoveryOperation(getSshPtyConsumerRecoveryOperations(this), record)
  }

  async removeSshPtyConsumerRecovery(
    targetId: string,
    expectedClientInstanceId?: string
  ): Promise<void> {
    await removeSshPtyConsumerRecoveryOperation(
      getSshPtyConsumerRecoveryOperations(this),
      targetId,
      expectedClientInstanceId
    )
  }

  getSshRemotePtyLeases(targetId?: string): SshRemotePtyLease[] {
    return getSshRemotePtyLeasesOperation(
      this[sshLeaseRecoveryOperationsContext].runtime.state,
      targetId
    )
  }

  upsertSshRemotePtyLease(lease: SshRemotePtyLeaseUpsert): void {
    upsertSshRemotePtyLeaseOperation(getSshPtyLeaseOperations(this), lease)
  }

  supersedeSshRemotePtyLeasesForBoundPane(targetId: string, leafId: string): void {
    supersedeSshRemotePtyLeasesForBoundPaneOperation(
      getSshPtyLeaseOperations(this),
      targetId,
      leafId
    )
  }

  reconcileSshRemotePtyLeasesForTarget(targetId: string): void {
    reconcileSshRemotePtyLeasesForTargetOperation(getSshPtyLeaseOperations(this), targetId)
  }

  markSshRemotePtyLeases(targetId: string, update: SshPtyLeaseUpdate): void {
    markSshRemotePtyLeasesOperation(getSshPtyLeaseOperations(this), targetId, update)
  }

  markSshRemotePtyLeasesForShutdown(targetId: string, update: SshPtyLeaseUpdate): void {
    markSshRemotePtyLeasesForShutdownOperation(getSshPtyLeaseOperations(this), targetId, update)
    this[sshLeaseRecoveryOperationsContext].runtime.dirtyProfileStateDomains?.add(
      'sshRemotePtyLeases'
    )
  }

  async markSshRemotePtyLeasesAsync(targetId: string, update: SshPtyLeaseUpdate): Promise<void> {
    await markSshRemotePtyLeasesAsyncOperation(getSshPtyLeaseOperations(this), targetId, update)
  }

  async markSshRemotePtyLeasesAttachedAsync(
    targetId: string,
    ptyIds: readonly string[]
  ): Promise<void> {
    await markSshRemotePtyLeasesAttachedAsyncOperation(
      getSshPtyLeaseOperations(this),
      targetId,
      ptyIds
    )
  }

  markSshRemotePtyLease(
    targetId: string,
    ptyId: string,
    update: SshPtyLeaseUpdate,
    options?: MarkSshRemotePtyLeaseOptions
  ): void {
    markSshRemotePtyLeaseOperation(getSshPtyLeaseOperations(this), targetId, ptyId, update, options)
  }

  setSshRemotePtyLeasePendingKill(
    targetId: string,
    ptyId: string,
    pendingKill: SshPendingPtyKill | null
  ): void {
    setSshRemotePtyLeasePendingKillOperation(
      getSshPtyLeaseOperations(this),
      targetId,
      ptyId,
      pendingKill
    )
  }

  removeSshRemotePtyLease(targetId: string, ptyId: string): void {
    removeSshRemotePtyLeaseOperation(getSshPtyLeaseOperations(this), targetId, ptyId)
  }

  removeSshRemotePtyLeases(targetId: string): void {
    removeSshRemotePtyLeasesOperation(getSshPtyLeaseOperations(this), targetId)
  }

  getSshRemotePtyKillIntents(targetId: string, now = Date.now()): SshPendingPtyKillEntry[] {
    return getSshRemotePtyKillIntentsOperation(
      this[sshLeaseRecoveryOperationsContext].runtime.state,
      targetId,
      now
    )
  }

  recordSshRemotePtyKillIntent(
    targetId: string,
    ptyId: string,
    intent: SshPendingPtyKill,
    evidence: PtyRetirementEvidence
  ): void {
    recordSshRemotePtyKillIntentOperation(
      getSshPtyLeaseOperations(this),
      targetId,
      ptyId,
      intent,
      evidence
    )
  }

  clearSshRemotePtyKillIntent(targetId: string, ptyId: string): void {
    clearSshRemotePtyKillIntentOperation(getSshPtyLeaseOperations(this), targetId, ptyId)
  }

  noteSshRemotePtyKillReplayAttempt(targetId: string, ptyId: string): void {
    noteSshRemotePtyKillReplayAttemptOperation(getSshPtyLeaseOperations(this), targetId, ptyId)
  }

  pruneExpiredSshRemotePtyKillIntents(targetId: string, now = Date.now()): void {
    pruneExpiredSshRemotePtyKillIntentsOperation(getSshPtyLeaseOperations(this), targetId, now)
  }
}

function runSshRecoveryDurableMutation<T>(
  owner: SshLeaseRecoveryOperations,
  domain: 'sshPtyConsumerRecoveries' | 'sshRemotePtyLeases',
  mutate: () => DurableProfileStateMutation<T>
): Promise<T> {
  const { runtime } = owner[sshLeaseRecoveryOperationsContext]
  return runtime.runDurableMutation(() => {
    const mutation = mutate()
    if (mutation.persist !== false) {
      runtime.dirtyProfileStateDomains?.add(domain)
    }
    return mutation
  })
}

function getSshPtyConsumerRecoveryOperations(
  owner: SshLeaseRecoveryOperations
): SshPtyConsumerRecoveryOperations {
  const { runtime } = owner[sshLeaseRecoveryOperationsContext]
  return {
    state: runtime.state,
    protectedSecrets: runtime.protectedSecrets,
    runDurableMutation: (mutate) =>
      runSshRecoveryDurableMutation(owner, 'sshPtyConsumerRecoveries', mutate)
  }
}

function getSshPtyBindingCleanupOperations(
  owner: SshLeaseRecoveryOperations
): SshPtyBindingCleanupOperations {
  return {
    state: owner[sshLeaseRecoveryOperationsContext].runtime.state,
    toComparablePtyId: (targetId, ptyId) =>
      owner[sshLeaseRecoveryOperationsContext].bindingRecovery.getRelayPtyIdForSshLeaseComparison(
        targetId,
        ptyId
      ),
    scheduleSave: () =>
      scheduleSave(owner[sshLeaseRecoveryOperationsContext].scheduling, WORKSPACE_SESSION_DOMAINS)
  }
}

function getSshPtyLeaseOperations(owner: SshLeaseRecoveryOperations): SshPtyLeaseOperations {
  return {
    state: owner[sshLeaseRecoveryOperationsContext].runtime.state,
    toStoredPtyId: (targetId, ptyId) =>
      owner[sshLeaseRecoveryOperationsContext].bindingRecovery.getRelayPtyIdForSshLeaseStorage(
        targetId,
        ptyId
      ),
    toComparablePtyId: (targetId, ptyId) =>
      owner[sshLeaseRecoveryOperationsContext].bindingRecovery.getRelayPtyIdForSshLeaseComparison(
        targetId,
        ptyId
      ),
    clearBindingsForTarget: (targetId) =>
      clearSshRemotePtyBindingsForTargetOperation(
        getSshPtyBindingCleanupOperations(owner),
        targetId
      ),
    clearBindingsForLeases: (targetId, leases) =>
      clearSshRemotePtyBindingsForLeasesOperation(
        getSshPtyBindingCleanupOperations(owner),
        targetId,
        leases
      ),
    flush: () => {
      owner[sshLeaseRecoveryOperationsContext].runtime.dirtyProfileStateDomains?.add(
        'sshRemotePtyLeases'
      )
      owner[sshLeaseRecoveryOperationsContext].flushBarriers.flush()
    },
    runDurableMutation: (mutate) =>
      runSshRecoveryDurableMutation(owner, 'sshRemotePtyLeases', mutate)
  }
}
