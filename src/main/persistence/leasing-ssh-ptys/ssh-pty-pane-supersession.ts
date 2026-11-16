import { toSshExecutionHostId } from '../../../shared/execution-host'
import { isTerminalLeafId } from '../../../shared/workspace-layout/stable-pane-id'
import type { SshRemotePtyLease } from '../../../shared/ssh-types'
import type { WorkspaceSessionState } from '../../../shared/workspace-session/workspace-session-state-types'
import type { SshPtyLeaseOperations } from './ssh-pty-lease-operations'

function durablyBoundPtyIdsForPane(
  operations: SshPtyLeaseOperations,
  targetId: string,
  leafId: string
): string[] {
  const findBindings = (session: WorkspaceSessionState | undefined): string[] =>
    Object.values(session?.terminalLayoutsByTabId ?? {})
      .map((layout) => layout?.ptyIdsByLeafId?.[leafId])
      .filter((ptyId): ptyId is string => Boolean(ptyId))
  // The SSH partition is authoritative; the local copy can retain a predecessor during reconnect.
  const ordered = [
    ...findBindings(operations.state.workspaceSessionsByHostId?.[toSshExecutionHostId(targetId)]),
    ...findBindings(operations.state.workspaceSession)
  ]
  return [...new Set(ordered.map((ptyId) => operations.toComparablePtyId(targetId, ptyId)))]
}

function isLiveLeaseState(state: SshRemotePtyLease['state']): boolean {
  return state === 'attached' || state === 'detached'
}

/** Supersession withdraws a route, never claims the remote shell exited. */
export function supersedeSiblingLeasesForPane(
  operations: SshPtyLeaseOperations,
  winner: SshRemotePtyLease,
  now: number
): boolean {
  if (!winner.worktreeId || !winner.leafId || !isLiveLeaseState(winner.state)) {
    return false
  }
  const boundPtyIds = durablyBoundPtyIdsForPane(operations, winner.targetId, winner.leafId)
  if (boundPtyIds.length > 0 && !boundPtyIds.includes(winner.ptyId)) {
    return false
  }
  let changed = false
  const superseded: SshRemotePtyLease[] = []
  for (const lease of operations.state.sshRemotePtyLeases ?? []) {
    if (
      lease.ptyId === winner.ptyId ||
      lease.targetId !== winner.targetId ||
      lease.worktreeId !== winner.worktreeId ||
      lease.leafId !== winner.leafId ||
      lease.state === 'terminated' ||
      (boundPtyIds.includes(lease.ptyId) && isLiveLeaseState(lease.state))
    ) {
      continue
    }
    if (lease.state === 'expired') {
      changed ||= lease.supersededBy !== winner.ptyId
      lease.supersededBy = winner.ptyId
      continue
    }
    lease.state = 'expired'
    lease.supersededBy = winner.ptyId
    lease.updatedAt = now
    changed = true
    superseded.push(lease)
  }
  if (superseded.length > 0) {
    operations.clearBindingsForLeases(winner.targetId, superseded)
  }
  return changed
}

function supersedeFromBoundPane(
  operations: SshPtyLeaseOperations,
  targetId: string,
  leafId: string,
  now: number
): boolean {
  if (!isTerminalLeafId(leafId)) {
    return false
  }
  const boundPtyIds = durablyBoundPtyIdsForPane(operations, targetId, leafId)
  if (boundPtyIds.length === 0) {
    return false
  }
  const winner = (operations.state.sshRemotePtyLeases ?? []).find(
    (lease) =>
      lease.targetId === targetId &&
      lease.leafId === leafId &&
      boundPtyIds.includes(lease.ptyId) &&
      isLiveLeaseState(lease.state)
  )
  return winner ? supersedeSiblingLeasesForPane(operations, winner, now) : false
}

/** The binding can land after the lease, so both writes must trigger supersession. */
export function supersedeSshRemotePtyLeasesForBoundPane(
  operations: SshPtyLeaseOperations,
  targetId: string,
  leafId: string
): void {
  if (supersedeFromBoundPane(operations, targetId, leafId, Date.now())) {
    operations.flush()
  }
}

export function reconcileSshRemotePtyLeasesForTarget(
  operations: SshPtyLeaseOperations,
  targetId: string
): void {
  const leafIds = new Set<string>()
  for (const lease of operations.state.sshRemotePtyLeases ?? []) {
    if (lease.targetId === targetId && lease.leafId) {
      leafIds.add(lease.leafId)
    }
  }
  const now = Date.now()
  let changed = false
  for (const leafId of leafIds) {
    changed = supersedeFromBoundPane(operations, targetId, leafId, now) || changed
  }
  if (changed) {
    operations.flush()
  }
}
