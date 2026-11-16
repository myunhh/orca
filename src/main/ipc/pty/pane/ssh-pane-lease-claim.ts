import { isTerminalLeafId } from '../../../../shared/workspace-layout/stable-pane-id'
import { getRelayPtyId } from '../provider/registry'
import type { Store } from '../../../persistence/loading-store/store'

/** Bind before superseding: a predecessor must remain reachable until its replacement is durable. */
export function claimSshPaneLease(args: {
  store: Store | undefined
  connectionId: string | null | undefined
  ptyId: string
  worktreeId: string | undefined
  tabId: string | undefined
  leafId: string | undefined
}): void {
  const { store, connectionId } = args
  if (!store || !connectionId) {
    return
  }
  const leafId = args.leafId && isTerminalLeafId(args.leafId) ? args.leafId : undefined
  store.upsertSshRemotePtyLease({
    targetId: connectionId,
    ptyId: getRelayPtyId(connectionId, args.ptyId),
    ...(args.worktreeId !== undefined ? { worktreeId: args.worktreeId } : {}),
    ...(args.tabId !== undefined ? { tabId: args.tabId } : {}),
    ...(leafId ? { leafId } : {}),
    state: 'attached',
    lastAttachedAt: Date.now()
  })
  if (leafId) {
    store.supersedeSshRemotePtyLeasesForBoundPane(connectionId, leafId)
  }
}
