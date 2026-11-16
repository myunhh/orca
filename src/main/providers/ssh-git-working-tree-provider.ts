import type {
  GitBranchCompareResult,
  GitCommitCompareResult
} from '../../shared/git/diff/git-diff-compare-types'
import type {
  GitHistoryOptions,
  GitHistoryResult
} from '../../shared/git/history/git-history-types'
import type { GitConflictOperation } from '../../shared/git/status/git-status-types'
import type { GitAdmissionTier } from '../../shared/rpc-contract/git-admission-tier-params'
import { SshGitNoninteractiveProvider } from './ssh-git-noninteractive-provider'
import type { IGitProvider } from './git-provider-contract'
import type { GitStageWorktreeScope } from '../../shared/git/paths/git-stage-worktree-scope'
import type { BranchSwitchCreation } from '../../shared/git/branch-switch-target'
import { z } from 'zod'
import type { BranchSwitchTarget } from '../../shared/git/branch-switch-target'
import {
  BranchSwitchLandedWithWarningError,
  type BranchSwitchResult
} from '../git/worktrees/checkout/branch-switch'

const RemoteBranchSwitchResultSchema = z.union([
  z.object({
    kind: z.literal('landed-with-warning'),
    branch: z.string(),
    head: z.string().optional(),
    message: z.string()
  }),
  z.object({
    branch: z.string(),
    head: z.string().optional(),
    previousBranch: z.string().nullable()
  })
])

export class SshGitWorkingTreeProvider extends SshGitNoninteractiveProvider {
  async switchBranch(
    worktreePath: string,
    target: string | BranchSwitchTarget | { commitId: string },
    agentBlocker: string | null
  ): Promise<BranchSwitchResult> {
    return this.runWithGitReadInvalidation(async () => {
      const result = RemoteBranchSwitchResultSchema.parse(
        await this.mux.request('git.switchBranch', { worktreePath, target, agentBlocker })
      )
      if ('kind' in result) {
        throw new BranchSwitchLandedWithWarningError(result.message, result.branch, result.head)
      }
      return result
    })
  }

  getHistoryRefs: IGitProvider['getHistoryRefs'] = async (worktreePath, query) =>
    (await this.mux.request('git.getHistoryRefs', {
      worktreePath,
      ...(query === undefined ? {} : { query })
    })) as Awaited<ReturnType<IGitProvider['getHistoryRefs']>>

  createBranch: IGitProvider['createBranch'] = (worktreePath, name, startPoint) =>
    this.runWithGitReadInvalidation(
      async () =>
        (await this.mux.request('git.createBranch', { worktreePath, name, startPoint })) as Awaited<
          ReturnType<IGitProvider['createBranch']>
        >
    )

  applyCommit: IGitProvider['applyCommit'] = (worktreePath, operation, commitId) =>
    this.runWithGitReadInvalidation(
      async () =>
        (await this.mux.request('git.applyCommit', {
          worktreePath,
          operation,
          commitId
        })) as Awaited<ReturnType<IGitProvider['applyCommit']>>
    )

  recoverSequencer: IGitProvider['recoverSequencer'] = (worktreePath, operation, action) =>
    this.runWithGitReadInvalidation(
      async () =>
        (await this.mux.request('git.recoverSequencer', {
          worktreePath,
          operation,
          action
        })) as Awaited<ReturnType<IGitProvider['recoverSequencer']>>
    )

  completeMerge: IGitProvider['completeMerge'] = (worktreePath) =>
    this.runWithGitReadInvalidation(
      async () =>
        (await this.mux.request('git.completeMerge', { worktreePath })) as Awaited<
          ReturnType<IGitProvider['completeMerge']>
        >
    )

  resolveConflict: IGitProvider['resolveConflict'] = async (worktreePath, filePath, resolution) => {
    await this.runWithGitReadInvalidation(async () => {
      await this.mux.request('git.resolveConflict', { worktreePath, filePath, resolution })
    })
  }

  async getMutationInFlight(worktreePath: string): Promise<{ inFlight: boolean }> {
    return (await this.mux.request('git.getMutationInFlight', { worktreePath })) as {
      inFlight: boolean
    }
  }

  async checkIgnoredPaths(worktreePath: string, relativePaths: string[]): Promise<string[]> {
    return (await this.mux.request('git.checkIgnored', {
      worktreePath,
      paths: relativePaths
    })) as string[]
  }

  async getHistory(
    worktreePath: string,
    options: GitHistoryOptions = {}
  ): Promise<GitHistoryResult> {
    return (await this.mux.request('git.history', {
      worktreePath,
      ...options
    })) as GitHistoryResult
  }

  async commit(
    worktreePath: string,
    message: string
  ): Promise<{ success: boolean; error?: string }> {
    return this.runWithGitReadInvalidation(
      async () =>
        (await this.mux.request('git.commit', {
          worktreePath,
          message
        })) as { success: boolean; error?: string }
    )
  }

  async stageFile(worktreePath: string, filePath: string): Promise<void> {
    await this.runWithGitReadInvalidation(async () => {
      await this.mux.request('git.stage', { worktreePath, filePath })
    })
  }

  async unstageFile(worktreePath: string, filePath: string): Promise<void> {
    await this.runWithGitReadInvalidation(async () => {
      await this.mux.request('git.unstage', { worktreePath, filePath })
    })
  }

  async bulkStageFiles(
    worktreePath: string,
    filePaths: string[],
    scope?: GitStageWorktreeScope
  ): Promise<void> {
    await this.runWithGitReadInvalidation(async () => {
      await this.mux.request('git.bulkStage', {
        worktreePath,
        filePaths,
        ...(scope === undefined ? {} : { scope })
      })
    })
  }

  async bulkUnstageFiles(worktreePath: string, filePaths: string[]): Promise<void> {
    await this.runWithGitReadInvalidation(async () => {
      await this.mux.request('git.bulkUnstage', { worktreePath, filePaths })
    })
  }

  async discardChanges(worktreePath: string, filePath: string): Promise<void> {
    await this.runWithGitReadInvalidation(async () => {
      await this.mux.request('git.discard', { worktreePath, filePath })
    })
  }

  async bulkDiscardChanges(worktreePath: string, filePaths: string[]): Promise<void> {
    await this.runWithGitReadInvalidation(async () => {
      await this.mux.request('git.bulkDiscard', { worktreePath, filePaths })
    })
  }

  async detectConflictOperation(worktreePath: string): Promise<GitConflictOperation> {
    return (await this.mux.request('git.conflictOperation', {
      worktreePath
    })) as GitConflictOperation
  }

  async abortMerge(worktreePath: string): Promise<void> {
    await this.runWithGitReadInvalidation(async () => {
      await this.mux.request('git.abortMerge', { worktreePath })
    })
  }

  async abortRebase(worktreePath: string): Promise<void> {
    await this.runWithGitReadInvalidation(async () => {
      await this.mux.request('git.abortRebase', { worktreePath })
    })
  }

  async checkoutBranch(
    worktreePath: string,
    branch: string,
    creation?: BranchSwitchCreation,
    detached?: boolean
  ): Promise<{ skippedPaths: string[] }> {
    return this.runWithGitReadInvalidation(
      async () =>
        (await this.mux.request('git.checkout', {
          worktreePath,
          branch,
          ...(creation === undefined ? {} : { creation }),
          ...(detached === undefined ? {} : { detached })
        })) as { skippedPaths: string[] }
    )
  }

  async listLocalBranches(worktreePath: string): ReturnType<IGitProvider['listLocalBranches']> {
    return (await this.mux.request('git.localBranches', { worktreePath })) as Awaited<
      ReturnType<IGitProvider['listLocalBranches']>
    >
  }

  async getBranchCompare(
    worktreePath: string,
    baseRef: string,
    options: { admissionTier?: GitAdmissionTier } = {}
  ): Promise<GitBranchCompareResult> {
    return (await this.mux.request('git.branchCompare', {
      worktreePath,
      baseRef,
      ...(options.admissionTier ? { admissionTier: options.admissionTier } : {})
    })) as GitBranchCompareResult
  }

  async getCommitCompare(worktreePath: string, commitId: string): Promise<GitCommitCompareResult> {
    return (await this.mux.request('git.commitCompare', {
      worktreePath,
      commitId
    })) as GitCommitCompareResult
  }
}
