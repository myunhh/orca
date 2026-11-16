import type { Repo } from '../../../../shared/repo-types'
import type { RemoveWorktreeResult } from '../../../../shared/worktree/create-types'
import type { RemoveWorktreeArgs } from '../ipc-context-schemas'
import type { WorktreeIpcContext } from '../worktree-ipc-context'
import { hostWorktreeTargetForRepo } from '../../../persistence/host-qualified-worktree-meta'
import { resolveWorktreeRemovalMetadata } from '../../../workspaces/removal/worktree-removal-repo-owner'
import { resolveWorktreeRemovalHome } from '../../../workspaces/removal/worktree-removal-execution-host-route'
import { findRegisteredDeletableWorktree } from '../../../workspaces/removal/worktree-removal-safety'
import { assertNestedWorktreeRemovalApproval } from '../../../workspaces/removal/nested-worktree-removal-plan'
import {
  removeRegisteredSshWorktree,
  type SshWorktreeRemovalRoute
} from '../../../workspaces/removal/ssh-worktree-removal'
import { removeUnregisteredSshWorktree } from '../../../workspaces/removal/ssh-unregistered-worktree-removal'
import { notifyWorktreesChanged } from '../../worktree-remote'
import { rememberPreservedBranchCleanupTarget } from './preserved-branch-cleanup'
import {
  removeWorktreeMetadataAndTransientState,
  stopPtysForDestructiveWorktreeRemoval
} from './worktree-removal-ownership'
import { invalidateAuthorizedRootsCacheForRepo } from './registered-worktree-roots-scoped-invalidation'

export async function executeSshWorktreeRemoval(
  context: WorktreeIpcContext,
  args: RemoveWorktreeArgs,
  repo: Repo,
  path: string,
  route: SshWorktreeRemovalRoute
): Promise<RemoveWorktreeResult> {
  const { runtime, store, mainWindow } = context
  const rows = await route.provider.listWorktrees(repo.path)
  const registered = findRegisteredDeletableWorktree(
    repo.path,
    path,
    rows,
    resolveWorktreeRemovalHome(route)
  )
  if (args.expectedCheckout) {
    assertNestedWorktreeRemovalApproval(registered ? [registered] : [], [args.expectedCheckout])
  }
  const meta = resolveWorktreeRemovalMetadata(store, repo.id, args.worktreeId, route.hostId)
  const target = hostWorktreeTargetForRepo(args.worktreeId, repo)
  const finishRemoval = (result: RemoveWorktreeResult = {}) => {
    rememberPreservedBranchCleanupTarget(
      args.worktreeId,
      route.hostId,
      result,
      registered?.head,
      meta?.pushTarget
    )
    runtime.clearOptimisticReconcileToken(args.worktreeId)
    removeWorktreeMetadataAndTransientState(
      { store, runtime },
      args.worktreeId,
      route.hostId,
      args.snapshotPruneBatchId
    )
    invalidateAuthorizedRootsCacheForRepo(store, repo)
    notifyWorktreesChanged(mainWindow, repo.id)
  }
  const stopPtys = () =>
    stopPtysForDestructiveWorktreeRemoval(runtime, args.worktreeId, {
      connectionId: route.connectionId,
      allowUnverifiedStop: args.allowUnverifiedPtyStop
    })
  const acquireWatcherRemoval = (file: string, connectionId: string) =>
    runtime.acquireFileWatcherRemoval(file, connectionId)
  if (!registered) {
    return removeUnregisteredSshWorktree({
      repo,
      route,
      target,
      path,
      registeredWorktrees: rows,
      meta,
      pushTarget: meta?.pushTarget,
      force: args.force === true,
      store,
      acquireWatcherRemoval,
      stopPtys,
      finishRemoval: () => finishRemoval()
    })
  }
  return removeRegisteredSshWorktree({
    repo,
    route,
    target,
    registeredWorktree: registered,
    pushTarget: meta?.pushTarget,
    store,
    force: args.force === true,
    deleteBranch: meta?.preserveBranchOnDelete !== true,
    runHooks: args.skipArchive !== true,
    allowFailedArchiveHook: args.allowFailedArchiveHook === true,
    acquireWatcherRemoval,
    stopPtys,
    finishRemoval
  })
}
