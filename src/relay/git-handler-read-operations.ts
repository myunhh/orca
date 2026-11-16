import type { RequestContext } from './dispatcher'
import { GitHandlerOperationContext } from './git-handler-operation-context'
import { getStatusOp } from './git-handler-status-ops'
import { streamRelayGitStdout } from './git-stdout-stream'
import { capGitStatusEntries, resolveGitStatusLimit } from '../shared/git/status/git-status-limit'
import {
  computeSubmoduleRangeEntries,
  resolveSubmoduleWorktreePath,
  resolveSubmoduleCommitRange
} from './git-handler-submodule-ops'
import type { GitExec } from './git-handler-ops'
import { checkIgnoredPathsOp } from './git-handler-check-ignore'
import { loadGitHistoryFromExecutor } from '../shared/git/history/git-history-execution'

function resolveSubmoduleStatusArea(
  params: Record<string, unknown>
): 'staged' | 'unstaged' | 'untracked' {
  if (params.area === 'staged' || params.area === 'unstaged' || params.area === 'untracked') {
    return params.area
  }
  return 'unstaged'
}

export class GitHandlerReadOperations extends GitHandlerOperationContext {
  async getStatus(params: Record<string, unknown>, context: RequestContext) {
    this.gitDiffReadDedupe.clear()
    return getStatusOp(this.git.bind(this), streamRelayGitStdout, params, {
      signal: context.signal
    })
  }

  // Why: fetch per-file submodule changes from the submodule worktree.
  async getSubmoduleStatus(params: Record<string, unknown>, context: RequestContext) {
    const worktreePath = params.worktreePath as string
    const submodulePath = params.submodulePath as string
    const area = resolveSubmoduleStatusArea(params)
    const staged = area === 'staged'
    const resolved = resolveSubmoduleWorktreePath(worktreePath, submodulePath)
    const limit = resolveGitStatusLimit(params.limit)
    // Why: staged expansion only represents HEAD→index; scanning the submodule worktree is wasted work.
    const workingResult = staged
      ? { entries: [], conflictOperation: 'unknown' }
      : await getStatusOp(
          this.git.bind(this),
          streamRelayGitStdout,
          {
            ...params,
            worktreePath: resolved
          },
          { signal: context.signal }
        )
    // Why: pointer/range probes are part of the same SSH request and must not outlive its cancellation.
    const requestGit: GitExec = (args, cwd, options) =>
      this.git(args, cwd, { ...options, signal: context.signal })
    // Why: moved clean gitlinks need committed changes surfaced.
    const { fromOid, toOid } = await resolveSubmoduleCommitRange(
      requestGit,
      worktreePath,
      submodulePath,
      staged
    )
    if (fromOid && toOid && fromOid !== toOid) {
      const rangeEntries = await computeSubmoduleRangeEntries(requestGit, resolved, fromOid, toOid)
      if (staged) {
        return { ...workingResult, ...capGitStatusEntries(rangeEntries, limit) }
      }
      const rangePaths = new Set(rangeEntries.map((entry) => entry.path))
      const entries = [
        ...rangeEntries,
        ...workingResult.entries.filter((entry) => !rangePaths.has(entry.path))
      ]
      return {
        ...workingResult,
        ...capGitStatusEntries(entries, limit, workingResult)
      }
    }
    if (staged) {
      return { ...workingResult, entries: [] }
    }
    return workingResult
  }

  async checkIgnored(params: Record<string, unknown>) {
    return checkIgnoredPathsOp(this.git.bind(this), params)
  }

  async history(params: Record<string, unknown>) {
    const worktreePath = params.worktreePath as string
    return loadGitHistoryFromExecutor(
      (args, cwd, stdin) => this.git(args, cwd, { stdin }),
      worktreePath,
      {
        limit: typeof params.limit === 'number' ? params.limit : undefined,
        baseRef: typeof params.baseRef === 'string' ? params.baseRef : null
      }
    )
  }
}
