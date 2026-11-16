import { z } from 'zod'
import { expandTilde } from './context'
import type { RequestContext } from './dispatcher'
import { GitHandlerOperationContext } from './git-handler-operation-context'
import {
  FullGitObjectId,
  GitBulkStage,
  GitCheckout,
  GitCommitAction,
  GitCreateBranch,
  GitDiff,
  GitRefs,
  GitResolveConflict,
  GitSequencer,
  WorktreeSelector
} from '../shared/rpc-contract/git-params'
import { checkoutBranch, listLocalBranches } from '../main/git/worktrees/checkout/checkout'
import { createBranch } from '../main/git/worktrees/checkout/create-branch'
import { applyCommit, recoverSequencer } from '../main/git/worktrees/checkout/commit-actions'
import { completeMerge } from '../main/git/source-control/commit-changes'
import {
  bulkStageFiles,
  resolveConflict,
  stageWorktreeChanges
} from '../main/git/source-control/staging'
import { getHistoryRefs } from '../main/git/source-control/history'
import { getDiff } from '../main/git/source-control/file-diff'
import { isGitWorktreeMutationInFlight } from '../main/git/command-runner/git-worktree-mutation-state'
import { getStatus } from '../main/git/source-control/status-read'
import {
  BranchSwitchLandedWithWarningError,
  switchBranchGuarded
} from '../main/git/worktrees/checkout/branch-switch'

const applySchema = GitSequencer.extend({ commitId: GitCommitAction.shape.commitId })
const recoverSchema = GitSequencer.extend({ action: z.enum(['abort', 'continue']) })
const creationSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('new') }),
    z.object({
      kind: z.literal('remote'),
      startPoint: z
        .string()
        .min(1)
        .refine((value) => !value.startsWith('-'))
    })
  ])
  .optional()

const switchSchema = WorktreeSelector.extend({
  target: z.union([
    z.string().min(1),
    z.object({ kind: z.enum(['local', 'remote', 'new']), name: z.string().min(1) }),
    z.object({ commitId: FullGitObjectId })
  ]),
  agentBlocker: z.string().nullable()
})
function worktreeParams(params: Record<string, unknown>) {
  return { ...params, worktree: params.worktreePath }
}

export class GitHandlerCurrentOperations extends GitHandlerOperationContext {
  async getMutationInFlight(params: Record<string, unknown>) {
    const input = WorktreeSelector.parse(worktreeParams(params))
    return { inFlight: await isGitWorktreeMutationInFlight(expandTilde(input.worktree), {}) }
  }

  async getHistoryRefs(params: Record<string, unknown>, context: RequestContext) {
    const input = GitRefs.parse(worktreeParams(params))
    return getHistoryRefs(expandTilde(input.worktree), input.query, { signal: context.signal })
  }

  async createBranch(params: Record<string, unknown>, context: RequestContext) {
    const input = GitCreateBranch.parse(worktreeParams(params))
    return this.runWithGitReadCacheClear(() =>
      createBranch(expandTilde(input.worktree), input.name, input.startPoint, {
        signal: context.signal
      })
    )
  }

  async applyCommit(params: Record<string, unknown>, context: RequestContext) {
    const input = applySchema.parse(worktreeParams(params))
    return this.runWithGitReadCacheClear(() =>
      applyCommit(expandTilde(input.worktree), input.operation, input.commitId, {
        signal: context.signal
      })
    )
  }

  async recoverSequencer(params: Record<string, unknown>, context: RequestContext) {
    const input = recoverSchema.parse(worktreeParams(params))
    return this.runWithGitReadCacheClear(() =>
      recoverSequencer(expandTilde(input.worktree), input.operation, input.action, {
        signal: context.signal
      })
    )
  }

  async completeMerge(params: Record<string, unknown>, context: RequestContext) {
    const input = WorktreeSelector.parse(worktreeParams(params))
    return this.runWithGitReadCacheClear(() =>
      completeMerge(expandTilde(input.worktree), { signal: context.signal })
    )
  }

  async resolveConflict(params: Record<string, unknown>, context: RequestContext) {
    const input = GitResolveConflict.parse(worktreeParams(params))
    return this.runWithGitReadCacheClear(() =>
      resolveConflict(expandTilde(input.worktree), input.filePath, input.resolution, {
        signal: context.signal
      })
    )
  }

  async switchBranch(params: Record<string, unknown>, context: RequestContext) {
    const input = switchSchema.parse(worktreeParams(params))
    const worktreePath = expandTilde(input.worktree)
    const options = { signal: context.signal }
    try {
      return await this.runWithGitReadCacheClear(() =>
        switchBranchGuarded(worktreePath, input.target, options, {
          getStatus: () => getStatus(worktreePath, options),
          checkout: (branch, creation) =>
            checkoutBranch(
              worktreePath,
              branch,
              {
                ...options,
                detached: typeof input.target !== 'string' && 'commitId' in input.target
              },
              creation
            ),
          getAgentBlocker: async () => input.agentBlocker
        })
      )
    } catch (error) {
      if (!(error instanceof BranchSwitchLandedWithWarningError)) {
        throw error
      }
      return {
        kind: 'landed-with-warning',
        branch: error.branch,
        ...(error.head === undefined ? {} : { head: error.head }),
        message: error.message
      }
    }
  }

  async checkout(params: Record<string, unknown>, context: RequestContext) {
    const input = GitCheckout.parse(worktreeParams(params))
    const creation = creationSchema.parse(params.creation)
    if (input.detached && creation) {
      throw new Error('Detached checkout cannot create a branch')
    }
    return this.runWithGitReadCacheClear(() =>
      checkoutBranch(
        expandTilde(input.worktree),
        input.branch,
        { signal: context.signal, detached: input.detached },
        creation
      )
    )
  }

  async localBranches(params: Record<string, unknown>, context: RequestContext) {
    const input = WorktreeSelector.parse(worktreeParams(params))
    return listLocalBranches(expandTilde(input.worktree), { signal: context.signal })
  }

  async bulkStage(params: Record<string, unknown>, context: RequestContext) {
    const input = GitBulkStage.parse(worktreeParams(params))
    return this.runWithGitReadCacheClear(async () => {
      if (input.scope) {
        return stageWorktreeChanges(expandTilde(input.worktree), input.scope, {
          signal: context.signal
        })
      }
      return bulkStageFiles(expandTilde(input.worktree), input.filePaths, {
        signal: context.signal
      })
    })
  }

  async getDiff(params: Record<string, unknown>, context: RequestContext) {
    const input = GitDiff.parse(worktreeParams(params))
    const result = await getDiff(
      expandTilde(input.worktree),
      input.filePath,
      input.staged,
      input.compareAgainstHead,
      { signal: context.signal, oldPath: input.oldPath }
    )
    return this.maybeStreamResponse(result, params, context)
  }
}
