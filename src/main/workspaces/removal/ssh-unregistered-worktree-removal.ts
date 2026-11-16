import type { Repo } from '../../../shared/repo-types'
import type { GitPushTarget, GitWorktreeInfo } from '../../../shared/worktree/types'
import type { WorktreeMeta } from '../../../shared/worktree/meta-types'
import type { HostWorktreeTarget } from '../../../shared/worktree/host-qualified-identity'
import type { RuntimeStore } from '../../runtime/construction/runtime-store-contract'
import { cleanupUnusedWorktreePushTargetRemoteSsh } from '../../ipc/worktree-remote'
import {
  assertWorktreeDoesNotContainRegisteredWorktree,
  canCleanupUnregisteredOrcaWorktreeDirectory,
  canSafelyRemoveOrphanedWorktreeDirectory,
  isDangerousWorktreeRemovalPath,
  isWorktreePathMissing,
  ORPHANED_WORKTREE_DIRECTORY_MESSAGE,
  UNREGISTERED_MISSING_WORKTREE_MESSAGE
} from './worktree-removal-safety'
import { isRemovalHomeAuthorityResolved } from './worktree-removal-home-guard'
import { resolveWorktreeRemovalHome } from './worktree-removal-execution-host-route'
import type { SshWorktreeRemovalRoute } from './ssh-worktree-removal'

export async function removeUnregisteredSshWorktree(args: {
  repo: Repo
  route: SshWorktreeRemovalRoute
  target: HostWorktreeTarget
  path: string
  registeredWorktrees: readonly GitWorktreeInfo[]
  meta?: WorktreeMeta
  pushTarget?: GitPushTarget
  force: boolean
  store: RuntimeStore
  acquireWatcherRemoval: (
    path: string,
    connectionId: string
  ) => Promise<{ finish: (removed: boolean) => Promise<void> }>
  stopPtys: () => Promise<void>
  finishRemoval: () => void | Promise<void>
}): Promise<{}> {
  const { route, repo, path, target } = args
  const fs = route.fsProvider
  if (!fs) {
    throw new Error('SSH filesystem provider unavailable for worktree cleanup.')
  }
  const home = resolveWorktreeRemovalHome(route)
  if (
    !isRemovalHomeAuthorityResolved(home) ||
    isDangerousWorktreeRemovalPath(path, repo.path, home)
  ) {
    throw new Error(`Refusing to delete protected worktree path: ${path}`)
  }
  assertWorktreeDoesNotContainRegisteredWorktree(path, args.registeredWorktrees)
  const missing = await isWorktreePathMissing(path, (file) => fs.stat(file))
  if (missing) {
    if (!args.force && !args.meta) {
      throw new Error(UNREGISTERED_MISSING_WORKTREE_MESSAGE)
    }
  } else {
    const lstat = fs.lstat?.bind(fs)
    if (!lstat || !canCleanupUnregisteredOrcaWorktreeDirectory({ meta: args.meta })) {
      throw new Error(`Refusing to delete unregistered worktree path: ${path}`)
    }
    const prove = async () => {
      if ((await lstat(path)).type !== 'directory') {
        return false
      }
      if (isDangerousWorktreeRemovalPath(await fs.realpath(path), repo.path, home)) {
        return false
      }
      return canSafelyRemoveOrphanedWorktreeDirectory(path, repo.path, home, {
        statPath: lstat,
        layoutStatPath: (file) => fs.stat(file),
        readPath: (file) => fs.readFile(file),
        realPath: (file) => fs.realpath(file)
      })
    }
    if (!(await prove())) {
      throw new Error(`Refusing to delete unproven orphaned worktree path: ${path}`)
    }
    if (!args.force) {
      throw new Error(ORPHANED_WORKTREE_DIRECTORY_MESSAGE)
    }
    const gate = await args.acquireWatcherRemoval(path, route.connectionId)
    let completed = false
    try {
      await args.stopPtys()
      if (!(await prove())) {
        throw new Error(`Worktree ownership changed during deletion: ${path}`)
      }
      await fs.deletePath(path, true)
      completed = true
    } finally {
      await gate.finish(completed)
    }
  }
  await cleanupUnusedWorktreePushTargetRemoteSsh(
    route.provider,
    repo.path,
    target,
    args.pushTarget,
    args.store
  )
  await args.finishRemoval()
  return {}
}
