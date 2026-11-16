import { ipcMain } from 'electron'
import type { GitDiffResult } from '../../../shared/git/diff/git-diff-compare-types'
import { getBranchDiff } from '../../git/source-control/branch-diff'
import { getCommitDiff } from '../../git/source-control/commit-diff'
import {
  validateFullGitObjectId,
  validateGitRelativeFilePath
} from './access/filesystem-path-containment'
import type { FilesystemHandlerContext } from './filesystem-handler-context'
import { requireReachableGitRoute } from '../../providers/execution-host-provider-dispatch'
import { requireSshGitProvider } from '../../providers/ssh-git-dispatch'
import { getConnectionExecutionHostId } from '../../../shared/execution-host'
import { readWorktreeGitUnlessWslStopped } from './wsl-gated-worktree-git-read'

export function registerFilesystemGitDiffHandlers(context: FilesystemHandlerContext): void {
  const { store } = context
  ipcMain.handle(
    'git:branchDiff',
    async (
      _event,
      args: {
        worktreePath: string
        compare: {
          baseRef: string
          baseOid: string
          headOid: string
          mergeBase: string
        }
        filePath: string
        oldPath?: string
        connectionId?: string
        /** Showing the diff tab or its Retry: a user act that may start a stopped WSL distro. */
        wakeWslDistro?: boolean
      }
    ): Promise<GitDiffResult> => {
      if (args.connectionId) {
        const diffs = await requireSshGitProvider(args.connectionId).getBranchDiff(
          args.worktreePath,
          args.compare.mergeBase,
          {
            includePatch: true,
            filePath: args.filePath,
            oldPath: args.oldPath,
            headOid: args.compare.headOid
          }
        )
        const diff = diffs[0]
        if (!diff) {
          throw new Error('Requested branch diff is no longer available.')
        }
        return diff
      }
      requireReachableGitRoute(getConnectionExecutionHostId(args.connectionId))
      return readWorktreeGitUnlessWslStopped(
        store,
        args.worktreePath,
        args.wakeWslDistro,
        (worktreePath, gitOptions) =>
          getBranchDiff(
            worktreePath,
            {
              mergeBase: args.compare.mergeBase,
              headOid: args.compare.headOid,
              filePath: validateGitRelativeFilePath(worktreePath, args.filePath),
              oldPath: args.oldPath
                ? validateGitRelativeFilePath(worktreePath, args.oldPath)
                : undefined
            },
            { ...gitOptions, admissionTier: 'interactive' }
          )
      )
    }
  )

  ipcMain.handle(
    'git:commitDiff',
    async (
      _event,
      args: {
        worktreePath: string
        commitOid: string
        parentOid?: string | null
        filePath: string
        oldPath?: string
        connectionId?: string
        /** Showing the diff tab or its Retry: a user act that may start a stopped WSL distro. */
        wakeWslDistro?: boolean
      }
    ): Promise<GitDiffResult> => {
      const commitOid = validateFullGitObjectId(args.commitOid, 'commitOid')
      const parentOid = args.parentOid ? validateFullGitObjectId(args.parentOid, 'parentOid') : null
      if (args.connectionId) {
        return requireSshGitProvider(args.connectionId).getCommitDiff(args.worktreePath, {
          commitOid,
          parentOid,
          filePath: args.filePath,
          oldPath: args.oldPath
        })
      }
      requireReachableGitRoute(getConnectionExecutionHostId(args.connectionId))
      return readWorktreeGitUnlessWslStopped(
        store,
        args.worktreePath,
        args.wakeWslDistro,
        (worktreePath, gitOptions) =>
          getCommitDiff(
            worktreePath,
            {
              commitOid,
              parentOid,
              filePath: validateGitRelativeFilePath(worktreePath, args.filePath),
              oldPath: args.oldPath
                ? validateGitRelativeFilePath(worktreePath, args.oldPath)
                : undefined
            },
            { ...gitOptions, admissionTier: 'interactive' }
          )
      )
    }
  )
}
