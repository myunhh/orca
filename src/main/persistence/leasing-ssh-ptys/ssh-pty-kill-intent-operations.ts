import type { PersistedState } from '../../../shared/persisted-state-types'
import {
  MAX_SSH_PENDING_PTY_KILLS_PER_TARGET,
  isSshPendingPtyKillExpired,
  normalizeSshPendingPtyKill,
  pendingSshPtyKillEntries,
  prunePendingSshPtyKills,
  type SshPendingPtyKill,
  type SshPendingPtyKillEntry
} from '../../../shared/ssh-pending-pty-kill'
import { sshRemotePtyLeaseAllowsReattach, type SshRemotePtyLease } from '../../../shared/ssh-types'
import type { PtyRetirementEvidence } from '../../pty/process-retirement/pty-exit-proof'
import type { SshPtyLeaseOperations } from './ssh-pty-lease-operations'

function isDisposableKillOnlyLease(lease: SshRemotePtyLease): boolean {
  return (
    lease.pendingKill === undefined &&
    !sshRemotePtyLeaseAllowsReattach(lease) &&
    lease.worktreeId === undefined &&
    lease.tabId === undefined &&
    lease.leafId === undefined
  )
}

export function getSshRemotePtyKillIntents(
  state: PersistedState,
  targetId: string,
  now: number
): SshPendingPtyKillEntry[] {
  const leases = (state.sshRemotePtyLeases ?? []).filter((lease) => lease.targetId === targetId)
  return prunePendingSshPtyKills(pendingSshPtyKillEntries(leases), now)
}

/** Aging out an intent says nothing about the remote process; keep any reattachable route. */
export function pruneExpiredSshRemotePtyKillIntents(
  operations: SshPtyLeaseOperations,
  targetId: string,
  now: number
): void {
  let changed = false
  const leases = operations.state.sshRemotePtyLeases ?? []
  for (const lease of leases) {
    if (
      lease.targetId === targetId &&
      lease.pendingKill &&
      isSshPendingPtyKillExpired(lease.pendingKill, now)
    ) {
      delete lease.pendingKill
      lease.updatedAt = now
      changed = true
    }
  }
  if (changed) {
    operations.state.sshRemotePtyLeases = leases.filter(
      (lease) => lease.targetId !== targetId || !isDisposableKillOnlyLease(lease)
    )
    operations.flush()
  }
}

function capPendingKillsForTarget(
  leases: SshRemotePtyLease[],
  targetId: string,
  now: number
): void {
  const scoped = leases.filter((lease) => lease.targetId === targetId && lease.pendingKill)
  if (scoped.length <= MAX_SSH_PENDING_PTY_KILLS_PER_TARGET) {
    return
  }
  const kept = new Set(
    prunePendingSshPtyKills(pendingSshPtyKillEntries(scoped), now).map((entry) => entry.ptyId)
  )
  const disposable = new Set<SshRemotePtyLease>()
  for (const lease of scoped) {
    if (!kept.has(lease.ptyId)) {
      delete lease.pendingKill
      lease.updatedAt = now
      if (isDisposableKillOnlyLease(lease)) {
        disposable.add(lease)
      }
    }
  }
  for (let index = leases.length - 1; index >= 0; index -= 1) {
    if (disposable.has(leases[index])) {
      leases.splice(index, 1)
    }
  }
}

/** The close-site evidence admits a routing tombstone even when no provider registered a lease. */
export function recordSshRemotePtyKillIntent(
  operations: SshPtyLeaseOperations,
  targetId: string,
  ptyId: string,
  intent: SshPendingPtyKill,
  _evidence: PtyRetirementEvidence
): void {
  const relayPtyId = operations.toStoredPtyId(targetId, ptyId)
  const normalized = normalizeSshPendingPtyKill(intent, relayPtyId)
  if (!normalized) {
    throw new Error('Invalid SSH PTY pending stop intent')
  }
  const now = normalized.requestedAt
  operations.state.sshRemotePtyLeases ??= []
  const leases = operations.state.sshRemotePtyLeases
  const existing = leases.find((lease) => lease.targetId === targetId && lease.ptyId === relayPtyId)
  if (existing) {
    const prior = existing.pendingKill
    existing.pendingKill =
      prior && prior.incarnationId === normalized.incarnationId
        ? {
            ...normalized,
            requestedAt: Math.min(prior.requestedAt, now),
            attempts: prior.attempts
          }
        : normalized
    existing.updatedAt = now
  } else {
    leases.push({
      targetId,
      ptyId: relayPtyId,
      state: 'terminated',
      createdAt: now,
      updatedAt: now,
      pendingKill: normalized
    })
  }
  capPendingKillsForTarget(leases, targetId, now)
  operations.flush()
}

export function clearSshRemotePtyKillIntent(
  operations: SshPtyLeaseOperations,
  targetId: string,
  ptyId: string
): void {
  const relayPtyId = operations.toStoredPtyId(targetId, ptyId)
  const leases = operations.state.sshRemotePtyLeases ?? []
  const index = leases.findIndex(
    (lease) => lease.targetId === targetId && lease.ptyId === relayPtyId
  )
  const lease = leases[index]
  if (!lease?.pendingKill) {
    return
  }
  delete lease.pendingKill
  if (isDisposableKillOnlyLease(lease)) {
    leases.splice(index, 1)
  } else {
    lease.updatedAt = Date.now()
  }
  operations.flush()
}

export function noteSshRemotePtyKillReplayAttempt(
  operations: SshPtyLeaseOperations,
  targetId: string,
  ptyId: string
): void {
  const relayPtyId = operations.toStoredPtyId(targetId, ptyId)
  const lease = (operations.state.sshRemotePtyLeases ?? []).find(
    (entry) => entry.targetId === targetId && entry.ptyId === relayPtyId
  )
  if (!lease?.pendingKill) {
    return
  }
  lease.pendingKill = { ...lease.pendingKill, attempts: lease.pendingKill.attempts + 1 }
  lease.updatedAt = Date.now()
  operations.flush()
}
