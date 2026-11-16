import type { Repo } from '../../../../shared/repo-types'
import type { GitPushTarget, GitWorktreeInfo } from '../../../../shared/worktree/types'
import type { WorktreeMeta } from '../../../../shared/worktree/meta-types'
import type { RuntimeStore } from '../../construction/runtime-store-contract'
import type { RuntimePreservedBranchCleanup } from '../../repositories/runtime-preserved-branch-cleanup'
import type {
  RemoveManagedWorktreeOptions,
  RuntimeWorktreeRemovalTarget
} from '../catalog/runtime-worktree-selection'
import { hostWorktreeTargetForRepo } from '../../../persistence/host-qualified-worktree-meta'
import {
  removeRegisteredSshWorktree,
  type SshWorktreeRemovalRoute
} from '../../../workspaces/removal/ssh-worktree-removal'
import { removeUnregisteredSshWorktree } from '../../../workspaces/removal/ssh-unregistered-worktree-removal'

export async function removeRuntimeSshWorktree(args: {
  repo: Repo
  route: SshWorktreeRemovalRoute
  target: RuntimeWorktreeRemovalTarget
  registeredWorktree: GitWorktreeInfo | null
  registeredWorktrees: readonly GitWorktreeInfo[]
  removedMeta?: WorktreeMeta
  removedPushTarget?: GitPushTarget
  store: RuntimeStore
  options: RemoveManagedWorktreeOptions
  preservedBranchCleanup: RuntimePreservedBranchCleanup
  acquireWatcherRemoval: (
    path: string,
    connectionId: string
  ) => Promise<{ finish: (removed: boolean) => Promise<void> }>
  stopPtys: (
    worktreeId: string,
    options: { connectionId?: string; allowUnverifiedStop?: boolean }
  ) => Promise<void>
  purgeRemovedWorktree: () => Promise<void>
  notifyWorktreesChanged: (repoId: string) => void
}) {
  const { repo, route, target, registeredWorktree, options } = args
  const ownedTarget = hostWorktreeTargetForRepo(target.id, repo)
  const stopPtys = () =>
    args.stopPtys(target.id, {
      connectionId: route.connectionId,
      allowUnverifiedStop: options.allowUnverifiedPtyStop
    })
  if (!registeredWorktree) {
    return removeUnregisteredSshWorktree({
      repo,
      route,
      target: ownedTarget,
      path: target.path,
      registeredWorktrees: args.registeredWorktrees,
      meta: args.removedMeta,
      pushTarget: args.removedPushTarget,
      force: options.force === true,
      store: args.store,
      acquireWatcherRemoval: args.acquireWatcherRemoval,
      stopPtys,
      finishRemoval: async () => {
        args.preservedBranchCleanup.delete(target.id, route.hostId)
        await args.purgeRemovedWorktree()
        args.notifyWorktreesChanged(repo.id)
      }
    })
  }
  return removeRegisteredSshWorktree({
    repo,
    route,
    target: ownedTarget,
    registeredWorktree,
    pushTarget: args.removedPushTarget,
    store: args.store,
    force: options.force === true,
    deleteBranch: options.deleteBranch ?? args.removedMeta?.preserveBranchOnDelete !== true,
    runHooks: options.runHooks === true,
    allowFailedArchiveHook: options.allowFailedArchiveHook === true,
    acquireWatcherRemoval: args.acquireWatcherRemoval,
    stopPtys,
    finishRemoval: async (result) => {
      args.preservedBranchCleanup.remember(
        target.id,
        route.hostId,
        result,
        registeredWorktree.head,
        args.removedPushTarget
      )
      await args.purgeRemovedWorktree()
      args.notifyWorktreesChanged(repo.id)
    }
  })
}
