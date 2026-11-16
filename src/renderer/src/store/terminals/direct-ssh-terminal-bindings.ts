import { getResolvedExecutionHostIdForWorktree } from '@/lib/workspace/ownership/resolved-worktree-execution-host'
import { toSshExecutionHostId } from '../../../../shared/execution-host'
import { parseAppSshPtyId } from '../../../../shared/ssh-pty-id'
import { isRemoteRuntimePtyId } from '../../../../shared/remote-runtime/remote-runtime-pty-id'
import type { DirectSshAuthority } from '../../../../shared/ssh-types'
import { useAppStore } from '../index'
import {
  directSshAuthoritiesEqual,
  getCurrentDirectSshAuthority
} from '../slices/worktrees/listing/direct-ssh-authority'

/** Reattach existing bindings; a reconnect alone never proves that a remote process exited. */
export function reconcileDirectSshTargetTerminals(
  authority: DirectSshAuthority,
  remountBoundPanes: boolean
): void {
  const state = useAppStore.getState()
  const hostId = toSshExecutionHostId(authority.targetId)
  if (!directSshAuthoritiesEqual(getCurrentDirectSshAuthority(state, hostId), authority)) {
    return
  }
  for (const [workspaceId, tabs] of Object.entries(state.tabsByWorktree)) {
    const workspaceHost = getResolvedExecutionHostIdForWorktree(state, workspaceId)
    const unifiedTabs = new Map(
      (state.unifiedTabsByWorktree[workspaceId] ?? []).map((tab) => [tab.entityId, tab])
    )
    for (const tab of tabs) {
      const explicitHost = unifiedTabs.get(tab.id)?.executionHostId
      if ((explicitHost ?? workspaceHost) !== hostId) {
        continue
      }
      const ptyIds = [
        tab.ptyId,
        ...(state.ptyIdsByTabId[tab.id] ?? []),
        ...Object.values(state.terminalLayoutsByTabId[tab.id]?.ptyIdsByLeafId ?? {})
      ].filter((id): id is string => Boolean(id))
      // A migrated runtime binding is authoritative even if an old workspace row survived.
      if (
        ptyIds.some((id) => {
          const ssh = parseAppSshPtyId(id)
          return (
            isRemoteRuntimePtyId(id) || (ssh !== null && ssh.connectionId !== authority.targetId)
          )
        })
      ) {
        continue
      }
      if (remountBoundPanes || ptyIds.length === 0 || state.deferredSshSessionIdsByTabId[tab.id]) {
        useAppStore.getState().remountTerminalTabForRecovery(tab.id)
      }
    }
  }
  useAppStore.getState().removeDeferredSshReconnectTarget(authority.targetId)
}
