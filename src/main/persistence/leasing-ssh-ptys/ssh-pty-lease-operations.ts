import type { StoreRuntimeState } from '../loading-store/store-runtime-state'
import { isTerminalLeafId } from '../../../shared/workspace-layout/stable-pane-id'
import { normalizeSshPendingPtyKill } from '../../../shared/ssh-pending-pty-kill'
import { supersedeSiblingLeasesForPane } from './ssh-pty-pane-supersession'
import type { PersistedState } from '../../../shared/persisted-state-types'
import type { SshPendingPtyKill } from '../../../shared/ssh-pending-pty-kill'
import type { SshRemotePtyLease } from '../../../shared/ssh-types'
import type { PtyRetirementEvidence } from '../../pty/process-retirement/pty-exit-proof'
import { invalidateLocalWorktreeMetadataPruneInputs } from '../../workspaces/catalog/local-worktree-metadata-prune-gate'
import { pruneRetiredSshRemotePtyLeaseTombstones } from './ssh-pty-lease-tombstone-retention'

export type SshPtyLeaseOperations = {
  state: PersistedState
  toStoredPtyId: (targetId: string, ptyId: string) => string
  toComparablePtyId: (targetId: string, ptyId: string) => string
  clearBindingsForTarget: (targetId: string) => void
  clearBindingsForLeases: (targetId: string, leases: SshRemotePtyLease[]) => boolean
  flush: () => void
  runDurableMutation: StoreRuntimeState['runDurableMutation']
}

export function getSshRemotePtyLeases(
  state: PersistedState,
  targetId?: string
): SshRemotePtyLease[] {
  const leases = state.sshRemotePtyLeases ?? []
  return leases.filter((lease) => targetId === undefined || lease.targetId === targetId)
}

export type SshPtyLeaseUpdate =
  | Exclude<SshRemotePtyLease['state'], 'terminated'>
  | PtyRetirementEvidence

export type SshRemotePtyLeaseUpsert = Omit<SshRemotePtyLease, 'createdAt' | 'updatedAt' | 'state'> &
  Partial<Pick<SshRemotePtyLease, 'createdAt' | 'updatedAt'>> & {
    state: Exclude<SshRemotePtyLease['state'], 'terminated'>
  }

export function upsertSshRemotePtyLease(
  operations: SshPtyLeaseOperations,
  lease: SshRemotePtyLeaseUpsert
): void {
  operations.state.sshRemotePtyLeases ??= []
  const normalized = {
    ...lease,
    ptyId: operations.toStoredPtyId(lease.targetId, lease.ptyId)
  }
  if (normalized.leafId !== undefined && !isTerminalLeafId(normalized.leafId)) {
    delete normalized.leafId
  }
  // Optional undefined fields from a reattach must not erase the saved pane identity.
  for (const [key, value] of Object.entries(normalized)) {
    if (value === undefined) {
      Reflect.deleteProperty(normalized, key)
    }
  }
  const leases = operations.state.sshRemotePtyLeases
  const existingIndex = leases.findIndex(
    (entry) => entry.targetId === normalized.targetId && entry.ptyId === normalized.ptyId
  )
  const existing = existingIndex === -1 ? undefined : leases[existingIndex]
  const now = Date.now()
  const next: SshRemotePtyLease = {
    ...existing,
    ...normalized,
    createdAt: existing?.createdAt ?? normalized.createdAt ?? now,
    updatedAt: normalized.updatedAt ?? now
  }
  if (next.state === 'attached' || next.state === 'detached') {
    delete next.supersededBy
    delete next.relayIdRecycled
  }
  if (existingIndex === -1) {
    leases.push(next)
  } else {
    leases[existingIndex] = next
  }
  supersedeSiblingLeasesForPane(operations, next, now)
  operations.flush()
}

function updateSshRemotePtyLeaseStates(
  operations: SshPtyLeaseOperations,
  targetId: string,
  update: SshPtyLeaseUpdate,
  ptyIds?: ReadonlySet<string>,
  admittedLeases?: ReadonlySet<SshRemotePtyLease>
): boolean {
  const state = typeof update === 'string' ? update : 'terminated'
  const now = Date.now()
  let changed = false
  const retired: SshRemotePtyLease[] = []
  for (const lease of operations.state.sshRemotePtyLeases ?? []) {
    if (
      lease.targetId !== targetId ||
      (ptyIds && !ptyIds.has(lease.ptyId)) ||
      (admittedLeases && !admittedLeases.has(lease))
    ) {
      continue
    }
    if (state === 'attached' && lease.state === 'terminated') {
      continue
    }
    // Only an exact successful attach can reclaim a route that previously expired.
    if (state === 'attached' && lease.state === 'expired' && !ptyIds) {
      continue
    }
    if (state === 'detached' && lease.state !== 'attached') {
      continue
    }
    if (lease.state !== state) {
      const reclaimed = state === 'attached' && lease.state === 'expired'
      lease.state = state
      lease.updatedAt = now
      if (state === 'attached') {
        lease.lastAttachedAt = now
      } else if (state === 'detached') {
        lease.lastDetachedAt = now
      }
      if (reclaimed) {
        delete lease.supersededBy
        delete lease.relayIdRecycled
      }
      changed = true
    }
    if (state === 'terminated') {
      retired.push(lease)
    }
  }
  const bindingsCleared = retired.length > 0 && operations.clearBindingsForLeases(targetId, retired)
  const tombstonesPruned =
    state === 'terminated' && pruneRetiredSshRemotePtyLeaseTombstones(operations, targetId)
  return changed || bindingsCleared || tombstonesPruned
}

export function markSshRemotePtyLeases(
  operations: SshPtyLeaseOperations,
  targetId: string,
  update: SshPtyLeaseUpdate
): void {
  if (updateSshRemotePtyLeaseStates(operations, targetId, update)) {
    operations.flush()
  }
}

/** The caller's final flush persists this; a new write must not race finalization. */
export function markSshRemotePtyLeasesForShutdown(
  operations: SshPtyLeaseOperations,
  targetId: string,
  update: SshPtyLeaseUpdate
): void {
  updateSshRemotePtyLeaseStates(operations, targetId, update)
}

export async function markSshRemotePtyLeasesAsync(
  operations: SshPtyLeaseOperations,
  targetId: string,
  update: SshPtyLeaseUpdate
): Promise<void> {
  const admitted = new Set(getSshRemotePtyLeases(operations.state, targetId))
  await operations.runDurableMutation(() => {
    const changed = updateSshRemotePtyLeaseStates(operations, targetId, update, undefined, admitted)
    return { value: undefined, persist: changed }
  })
}

export async function markSshRemotePtyLeasesAttachedAsync(
  operations: SshPtyLeaseOperations,
  targetId: string,
  ptyIds: readonly string[]
): Promise<void> {
  const relayPtyIds = new Set(ptyIds.map((ptyId) => operations.toStoredPtyId(targetId, ptyId)))
  const admitted = new Set(getSshRemotePtyLeases(operations.state, targetId))
  await operations.runDurableMutation(() => {
    const changed = updateSshRemotePtyLeaseStates(
      operations,
      targetId,
      'attached',
      relayPtyIds,
      admitted
    )
    return { value: undefined, persist: changed }
  })
}

export type MarkSshRemotePtyLeaseOptions = { relayIdRecycled?: true }

/** Terminated means explicit close or proven exit; route loss remains expired and preserves bindings. */
export function markSshRemotePtyLease(
  operations: SshPtyLeaseOperations,
  targetId: string,
  ptyId: string,
  update: SshPtyLeaseUpdate,
  options?: MarkSshRemotePtyLeaseOptions
): void {
  const relayPtyId = operations.toStoredPtyId(targetId, ptyId)
  const lease = operations.state.sshRemotePtyLeases?.find(
    (entry) => entry.targetId === targetId && entry.ptyId === relayPtyId
  )
  if (!lease) {
    return
  }
  const recycledChanged = options?.relayIdRecycled === true && lease.relayIdRecycled !== true
  if (recycledChanged) {
    lease.relayIdRecycled = true
  }
  const changed = updateSshRemotePtyLeaseStates(operations, targetId, update, new Set([relayPtyId]))
  if (changed || recycledChanged) {
    operations.flush()
  }
}

export function setSshRemotePtyLeasePendingKill(
  operations: SshPtyLeaseOperations,
  targetId: string,
  ptyId: string,
  pendingKill: SshPendingPtyKill | null
): void {
  const relayPtyId = operations.toStoredPtyId(targetId, ptyId)
  const lease = operations.state.sshRemotePtyLeases?.find(
    (entry) => entry.targetId === targetId && entry.ptyId === relayPtyId
  )
  const normalized = pendingKill && normalizeSshPendingPtyKill(pendingKill, relayPtyId)
  if (pendingKill && !normalized) {
    throw new Error('Invalid SSH PTY pending stop intent')
  }
  if (!lease || (!pendingKill && !lease.pendingKill)) {
    return
  }
  if (normalized) {
    lease.pendingKill = normalized
  } else {
    delete lease.pendingKill
  }
  lease.updatedAt = Date.now()
  operations.flush()
}

export function removeSshRemotePtyLease(
  operations: SshPtyLeaseOperations,
  targetId: string,
  ptyId: string
): void {
  const relayPtyId = operations.toStoredPtyId(targetId, ptyId)
  const leases = operations.state.sshRemotePtyLeases ?? []
  operations.clearBindingsForLeases(
    targetId,
    leases.filter((lease) => lease.targetId === targetId && lease.ptyId === relayPtyId)
  )
  const retained = leases.filter(
    (lease) => lease.targetId !== targetId || lease.ptyId !== relayPtyId
  )
  if (retained.length !== leases.length) {
    operations.state.sshRemotePtyLeases = retained
    invalidateLocalWorktreeMetadataPruneInputs()
    operations.flush()
  }
}

export function removeSshRemotePtyLeases(
  operations: SshPtyLeaseOperations,
  targetId: string
): void {
  operations.state.sshRemotePtyLeases ??= []
  operations.clearBindingsForTarget(targetId)
  const before = operations.state.sshRemotePtyLeases.length
  operations.state.sshRemotePtyLeases = operations.state.sshRemotePtyLeases.filter(
    (lease) => lease.targetId !== targetId
  )
  if (operations.state.sshRemotePtyLeases.length !== before) {
    // Removing the last lease may release a metadata ownership claim.
    invalidateLocalWorktreeMetadataPruneInputs()
    operations.flush()
  }
}
