import { ipcMain } from 'electron'
import type { GitConflictOperation } from '../../../shared/git/status/git-status-types'
import { getConnectionExecutionHostId } from '../../../shared/execution-host'
import {
  abortMerge,
  abortRebase,
  detectConflictOperation
} from '../../git/source-control/git-conflict-operation'
import { requireReachableGitRoute } from '../../providers/execution-host-provider-dispatch'
import { requireSshGitProvider } from '../../providers/ssh-git-dispatch'
import { assertWslUncPathRunning } from '../../wsl/filesystem/wsl-unc-access-gate'
import { resolveRegisteredWorktreePath } from '../worktrees/removal/registered-worktree-roots-cache'
import { getLocalGitOptionsForRegisteredWorktree } from '../local-worktree-runtime-options'
import type { FilesystemHandlerContext } from './filesystem-handler-context'

export function registerFilesystemGitConflictHandlers({ store }: FilesystemHandlerContext): void {
  // Filesystem probes clear inactive-worktree conflict badges without a full Git status.
  ipcMain.handle(
    'git:conflictOperation',
    async (
      _event,
      args: { worktreePath: string; connectionId?: string }
    ): Promise<GitConflictOperation> => {
      if (args.connectionId) {
        return requireSshGitProvider(args.connectionId).detectConflictOperation(args.worktreePath)
      }
      requireReachableGitRoute(getConnectionExecutionHostId(args.connectionId))
      // A 3 s poll for inactive worktrees: its UNC reads would boot a stopped WSL distro (E9).
      await assertWslUncPathRunning(args.worktreePath)
      const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
      const gitOptions = getLocalGitOptionsForRegisteredWorktree(
        store,
        args.worktreePath,
        worktreePath
      )
      return detectConflictOperation(worktreePath, gitOptions)
    }
  )

  ipcMain.handle(
    'git:abortMerge',
    async (_event, args: { worktreePath: string; connectionId?: string }): Promise<void> => {
      if (args.connectionId) {
        return requireSshGitProvider(args.connectionId).abortMerge(args.worktreePath)
      }
      requireReachableGitRoute(getConnectionExecutionHostId(args.connectionId))
      const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
      const gitOptions = getLocalGitOptionsForRegisteredWorktree(
        store,
        args.worktreePath,
        worktreePath
      )
      await abortMerge(worktreePath, { ...gitOptions, admissionTier: 'interactive' })
    }
  )

  ipcMain.handle(
    'git:abortRebase',
    async (_event, args: { worktreePath: string; connectionId?: string }): Promise<void> => {
      if (args.connectionId) {
        return requireSshGitProvider(args.connectionId).abortRebase(args.worktreePath)
      }
      requireReachableGitRoute(getConnectionExecutionHostId(args.connectionId))
      const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
      const gitOptions = getLocalGitOptionsForRegisteredWorktree(
        store,
        args.worktreePath,
        worktreePath
      )
      await abortRebase(worktreePath, { ...gitOptions, admissionTier: 'interactive' })
    }
  )
}
