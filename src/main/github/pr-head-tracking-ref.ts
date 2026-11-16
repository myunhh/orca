import { gitExecFileAsync } from '../git/command-runner/git-exec-file'
import {
  githubPullRequestHeadLocalRef,
  isSafeReviewHeadFetchRemote,
  isValidReviewHeadNumber,
  REVIEW_HEAD_FETCH_TIMEOUT_MS
} from '../../shared/review-head-tracking-ref'
import { getReviewHeadRemoteComponent } from '../git/remotes/review-head-remote-identity'
import {
  ExecutionHostNotDispatchableError,
  resolveGitRouteForHost
} from '../providers/execution-host-provider-dispatch'
import { requireSshGitProvider } from '../providers/ssh-git-dispatch'
import { getRepoExecutionHostId } from '../../shared/execution-host'
import type { Repo } from '../../shared/repo-types'

type LocalGitExecOptions = {
  cwd: string
  wslDistro?: string
}

export async function fetchPrHeadTrackingRef(
  repo: { path: string } & Pick<Repo, 'connectionId' | 'executionHostId'>,
  remote: string,
  branch: string,
  options: { localGitExecOptions?: LocalGitExecOptions } = {}
): Promise<void> {
  const route = resolveGitRouteForHost(getRepoExecutionHostId(repo))
  if (route.kind === 'runtime') {
    throw new ExecutionHostNotDispatchableError(route.hostId)
  }
  if (route.kind === 'ssh') {
    await requireSshGitProvider(route.connectionId).fetchRemoteTrackingRef(
      repo.path,
      remote,
      branch,
      `refs/remotes/${remote}/${branch}`
    )
    return
  }
  await gitExecFileAsync(
    ['fetch', remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`],
    {
      ...(options.localGitExecOptions ?? { cwd: repo.path }),
      timeout: REVIEW_HEAD_FETCH_TIMEOUT_MS
    }
  )
}

export async function fetchGitHubPullRequestHeadRef(
  repo: { path: string } & Pick<Repo, 'connectionId' | 'executionHostId'>,
  remote: string,
  prNumber: number,
  options: { localGitExecOptions?: LocalGitExecOptions } = {}
): Promise<string> {
  if (!isValidReviewHeadNumber(prNumber)) {
    throw new Error(`Invalid pull request number: ${String(prNumber)}`)
  }
  if (!isSafeReviewHeadFetchRemote(remote)) {
    throw new Error('Pull request fetch remote must not start with "-".')
  }
  const route = resolveGitRouteForHost(getRepoExecutionHostId(repo))
  if (route.kind === 'runtime') {
    throw new ExecutionHostNotDispatchableError(route.hostId)
  }
  if (route.kind === 'ssh') {
    return requireSshGitProvider(route.connectionId).fetchGitHubPullRequestHead(
      repo.path,
      remote,
      prNumber
    )
  }
  const localGitExecOptions = options.localGitExecOptions ?? { cwd: repo.path }
  const remoteComponent = await getReviewHeadRemoteComponent(remote, localGitExecOptions)
  // Return the written ref so callers do not recompute its remote identity.
  const localRef = githubPullRequestHeadLocalRef(remoteComponent, prNumber)
  await gitExecFileAsync(
    ['fetch', '--no-tags', remote, `+refs/pull/${prNumber}/head:${localRef}`],
    { ...localGitExecOptions, timeout: REVIEW_HEAD_FETCH_TIMEOUT_MS }
  )
  return localRef
}
