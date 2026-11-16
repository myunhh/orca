import type { ExecutionHostId } from '../../../../shared/execution-host'
import type { Repo } from '../../../../shared/repo-types'
import type { GitWorktreeInfo } from '../../../../shared/worktree/types'
import type { RemoveWorktreeResult } from '../../../../shared/worktree/create-types'
import type { RuntimeStore } from '../../construction/runtime-store-contract'
import type { RuntimePreservedBranchCleanup } from '../../repositories/runtime-preserved-branch-cleanup'
import type {
  RemoveManagedWorktreeOptions,
  RuntimeWorktreeRemovalTarget
} from '../catalog/runtime-worktree-selection'
import type { LocalProjectWorktreeGitOptions } from '../../../workspaces/execution-host/project-runtime-git-options'
import { isStaleLocalWorktreeRegistration } from '../catalog/stale-worktree-registration-preflight'
import { resolveWorktreeRemovalMetadata } from '../../../workspaces/removal/worktree-removal-repo-owner'
import {
  resolveWorktreeRemovalHome,
  resolveWorktreeRemovalRoute
} from '../../../workspaces/removal/worktree-removal-execution-host-route'
import { authorizeUnregisteredWindowsRemoval } from '../../../git/worktrees/removal/windows-worktree-removal'
import { findRegisteredDeletableWorktree } from '../../../workspaces/removal/worktree-removal-safety'
import { removeStaleLocalWorktreeRegistration } from '../../../workspaces/removal/local-worktree-removal-recovery'
import { cleanupUnusedWorktreePushTargetRemote } from '../../../ipc/worktree-remote'
import { listWorktreesOnRemovalRoute } from './worktree-removal-route-listing'
import { removeRuntimeSshWorktree } from './runtime-ssh-worktree-removal'
import { removeRuntimeUnregisteredWorktree } from './runtime-unregistered-worktree-removal'
import { removeRuntimeRegisteredLocalWorktree } from './runtime-registered-local-worktree-removal'

type RuntimeWorktreeRemovalPorts = {
  acquireWatcherRemoval: (
    path: string,
    connectionId?: string
  ) => Promise<{ finish: (removed: boolean) => Promise<void> }>
  stopPtys: (
    worktreeId: string,
    options: { connectionId?: string; allowUnverifiedStop?: boolean }
  ) => Promise<void>
  retryFailedRemoval: (
    route: { kind: string },
    target: { id: string; path: string },
    worktrees: readonly GitWorktreeInfo[],
    options: RemoveManagedWorktreeOptions,
    localOptions: LocalProjectWorktreeGitOptions
  ) => Promise<boolean>
  closeWatchers: (path: string) => Promise<void>
  purgeRemovedWorktree: () => Promise<void>
  notifyWorktreesChanged: (repoId: string) => void
  publish: (repoId: string) => void
  onRemoved: () => void
}

/** Execute only after the caller resolved project ownership and excluded folder/orphan registrations. */
export async function executeRuntimeWorktreeRemoval(args: {
  repo: Repo
  target: RuntimeWorktreeRemovalTarget
  removalHostId: ExecutionHostId
  cleanupHostId?: ExecutionHostId
  store: RuntimeStore
  options: RemoveManagedWorktreeOptions
  preservedBranchCleanup: RuntimePreservedBranchCleanup
  ports: RuntimeWorktreeRemovalPorts
}): Promise<RemoveWorktreeResult & { warning?: string }> {
  const {
    repo,
    target,
    removalHostId,
    cleanupHostId,
    store,
    options,
    preservedBranchCleanup,
    ports
  } = args
  const {
    force = false,
    runHooks = false,
    allowUnverifiedPtyStop = false,
    allowFailedArchiveHook = false
  } = options
  const route = resolveWorktreeRemovalRoute(removalHostId)
  const { localWorktreeGitOptions, registeredWorktrees } = await listWorktreesOnRemovalRoute(
    route,
    repo,
    store
  )
  const removedMeta = resolveWorktreeRemovalMetadata(store, target.repoId, target.id, removalHostId)
  const removedPushTarget = removedMeta?.pushTarget ?? target.pushTarget
  const registeredWorktree = findRegisteredDeletableWorktree(
    repo.path,
    target.path,
    registeredWorktrees,
    resolveWorktreeRemovalHome(route)
  )
  if (route.kind === 'ssh') {
    return removeRuntimeSshWorktree({
      repo,
      route,
      target,
      registeredWorktree,
      registeredWorktrees,
      removedMeta,
      removedPushTarget,
      store,
      options,
      preservedBranchCleanup,
      acquireWatcherRemoval: ports.acquireWatcherRemoval,
      stopPtys: ports.stopPtys,
      purgeRemovedWorktree: ports.purgeRemovedWorktree,
      notifyWorktreesChanged: ports.notifyWorktreesChanged
    })
  }
  await authorizeUnregisteredWindowsRemoval(
    !!registeredWorktree,
    repo.path,
    target.path,
    force,
    localWorktreeGitOptions
  )
  if (
    await ports.retryFailedRemoval(
      route,
      target,
      registeredWorktrees,
      options,
      localWorktreeGitOptions
    )
  ) {
    return { removing: true }
  }
  if (!registeredWorktree) {
    return removeRuntimeUnregisteredWorktree({
      repo,
      target,
      registeredWorktrees,
      removedMeta,
      removedPushTarget,
      force,
      allowUnverifiedPtyStop,
      route,
      localOptions: localWorktreeGitOptions,
      store,
      acquireWatcherRemoval: ports.acquireWatcherRemoval,
      stopPtys: (worktreeId, allowUnverifiedStop) =>
        ports.stopPtys(worktreeId, { allowUnverifiedStop }),
      finishRemoval: async () => {
        preservedBranchCleanup.delete(target.id, cleanupHostId)
        await ports.purgeRemovedWorktree()
        ports.notifyWorktreesChanged(repo.id)
      }
    })
  }
  const canonicalWorktreePath = registeredWorktree.path
  const deleteBranch = options.deleteBranch ?? removedMeta?.preserveBranchOnDelete !== true
  if (
    await isStaleLocalWorktreeRegistration(
      registeredWorktree,
      force,
      removedMeta,
      localWorktreeGitOptions
    )
  ) {
    const removalResult = await removeStaleLocalWorktreeRegistration({
      canonicalWorktreePath,
      repoPath: repo.path,
      localWorktreeGitOptions,
      registeredWorktree,
      deleteBranch
    })
    await cleanupUnusedWorktreePushTargetRemote(
      repo.path,
      target.id,
      removedPushTarget,
      store,
      localWorktreeGitOptions
    )
    preservedBranchCleanup.remember(
      target.id,
      cleanupHostId,
      removalResult,
      registeredWorktree.head,
      removedPushTarget
    )
    await ports.purgeRemovedWorktree()
    ports.notifyWorktreesChanged(repo.id)
    return removalResult ?? {}
  }
  return removeRuntimeRegisteredLocalWorktree({
    repo,
    target,
    registeredWorktree,
    removedPushTarget,
    store,
    localOptions: localWorktreeGitOptions,
    hasLocalOptions: Object.keys(localWorktreeGitOptions).length > 0,
    force,
    runHooks,
    allowFailedArchiveHook,
    allowUnverifiedPtyStop,
    deleteBranch,
    requestedDeleteBranch: options.deleteBranch,
    acquireWatcherRemoval: ports.acquireWatcherRemoval,
    stopPtys: () => ports.stopPtys(target.id, { allowUnverifiedStop: allowUnverifiedPtyStop }),
    closeWatchers: ports.closeWatchers,
    preserveBranchHead: (result, fallbackHead) =>
      preservedBranchCleanup.preserveHead(result, fallbackHead),
    finishRemoval: async (result, rememberBranch, fallbackHead) => {
      if (rememberBranch) {
        preservedBranchCleanup.remember(
          target.id,
          cleanupHostId,
          result,
          fallbackHead,
          removedPushTarget
        )
      } else {
        preservedBranchCleanup.delete(target.id, cleanupHostId)
      }
      await ports.purgeRemovedWorktree()
    },
    onRemoved: ports.onRemoved,
    publish: () => ports.publish(repo.id)
  })
}
