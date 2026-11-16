import { ipcMain } from 'electron'
import type { GitHubPrStartPoint, GitPushTarget } from '../../../../shared/worktree/types'
import { isFolderRepo } from '../../../../shared/repo-kind'
import { getRepoExecutionHostId } from '../../../../shared/execution-host'
import { gitExecFileAsync } from '../../../git/command-runner/git-exec-file'
import {
  getLocalProjectGhExecOptions,
  getLocalProjectGitExecOptions,
  getWorktreeCreatePrefetchGitOptions
} from '../../../workspaces/execution-host/project-runtime-git-options'
import { requireSshGitProvider } from '../../../providers/ssh-git-dispatch'
import {
  resolveGitRouteForHost,
  ExecutionHostNotDispatchableError
} from '../../../providers/execution-host-provider-dispatch'
import {
  fetchPrHeadTrackingRef,
  fetchGitHubPullRequestHeadRef
} from '../../../github/pr-head-tracking-ref'
import { resolveGitHubPrStartPoint } from '../../../github/pr-start-point'
import { resolvePrStartPointUnlessWslStopped } from '../../../github/pr-start-point-wsl-gate'
import { resolveGitHubReviewHeadRemote } from '../../../github/review-head-remote'
import type { WorktreeIpcContext } from '../worktree-ipc-context'
import { reviewStartPointFailure } from '../../../../shared/review-start-point-failure-copy'

export function registerReviewBaseHandlers(context: WorktreeIpcContext): void {
  const { store, runtime } = context

  ipcMain.handle(
    'worktrees:resolvePrBase',
    async (
      _event,
      args: {
        repoId: string
        prNumber: number
        headRefName?: string
        baseRefName?: string
        isCrossRepository?: boolean
        /** The user creating or launching from the PR: it may start a stopped WSL distro. */
        wakeWslDistro?: boolean
      }
    ): Promise<GitHubPrStartPoint | { error: string }> => {
      const repo = store.getRepo(args.repoId)
      if (!repo) {
        return reviewStartPointFailure('repoNotFound')
      }
      if (isFolderRepo(repo)) {
        return reviewStartPointFailure('folderUnsupported')
      }
      // SSH ownership may exist only in executionHostId.
      const route = resolveGitRouteForHost(getRepoExecutionHostId(repo))
      if (route.kind === 'runtime') {
        throw new ExecutionHostNotDispatchableError(route.hostId)
      }
      const connectionId = route.kind === 'ssh' ? route.connectionId : null
      const gitExec = async (args: string[]): Promise<{ stdout: string; stderr: string }> => {
        if (!connectionId) {
          return gitExecFileAsync(args, getLocalProjectGitExecOptions(store, repo))
        }
        return requireSshGitProvider(connectionId).exec(args, repo.path)
      }
      const localGhOptions = connectionId
        ? repo.ghAccount
          ? { ghAccount: repo.ghAccount }
          : undefined
        : getLocalProjectGhExecOptions(store, repo)
      const fetchRemoteTrackingRef = (remote: string, branch: string): Promise<void> =>
        fetchPrHeadTrackingRef(
          repo,
          remote,
          branch,
          connectionId
            ? {}
            : {
                localGitExecOptions: getLocalProjectGitExecOptions(store, repo)
              }
        )
      const fetchPullRequestHeadRef = (remote: string, prNumber: number): Promise<string> =>
        fetchGitHubPullRequestHeadRef(
          repo,
          remote,
          prNumber,
          connectionId
            ? {}
            : {
                localGitExecOptions: getLocalProjectGitExecOptions(store, repo)
              }
        )

      // Source Control's push-target ensure asks unprompted; it must not start a stopped distro (E9).
      const { wslDistro } = connectionId ? {} : getWorktreeCreatePrefetchGitOptions(store, repo)
      return resolvePrStartPointUnlessWslStopped(
        { path: repo.path, wslDistro },
        { wakeWslDistro: args.wakeWslDistro },
        () =>
          resolveGitHubPrStartPoint({
            repoPath: repo.path,
            prNumber: args.prNumber,
            headRefName: args.headRefName,
            baseRefName: args.baseRefName,
            isCrossRepository: args.isCrossRepository,
            issueSourcePreference: repo.issueSourcePreference,
            connectionId,
            localGitOptions: localGhOptions,
            gitExec,
            fetchRemoteTrackingRef,
            fetchPullRequestHeadRef,
            // Share source preference and hosting identity across local, WSL and SSH creation.
            resolveRemote: () =>
              resolveGitHubReviewHeadRemote({
                repoPath: repo.path,
                issueSourcePreference: repo.issueSourcePreference,
                connectionId,
                localGitOptions: localGhOptions,
                gitExec
              })
          })
      )
    }
  )

  ipcMain.handle(
    'worktrees:resolveMrBase',
    async (
      _event,
      args: {
        repoId: string
        mrIid: number
        sourceBranch?: string
        targetBranch?: string
        isCrossRepository?: boolean
        /** The user creating from the MR: it may start a stopped WSL distro. */
        wakeWslDistro?: boolean
      }
    ): Promise<
      | { baseBranch: string; compareBaseRef?: string; pushTarget?: GitPushTarget }
      | { error: string }
    > => {
      return runtime.resolveManagedMrBase({
        repoSelector: `id:${args.repoId}`,
        mrIid: args.mrIid,
        sourceBranch: args.sourceBranch,
        targetBranch: args.targetBranch,
        isCrossRepository: args.isCrossRepository,
        wakeWslDistro: args.wakeWslDistro
      })
    }
  )
}
