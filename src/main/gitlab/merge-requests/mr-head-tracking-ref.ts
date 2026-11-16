import {
  gitlabMergeRequestHeadLocalRef,
  isSafeReviewHeadFetchRemote,
  isValidReviewHeadNumber,
  REVIEW_HEAD_FETCH_TIMEOUT_MS
} from '../../../shared/review-head-tracking-ref'
import { gitExecFileAsync } from '../../git/command-runner/git-exec-file'
import { getReviewHeadRemoteComponent } from '../../git/remotes/review-head-remote-identity'
import {
  ExecutionHostNotDispatchableError,
  resolveGitRouteForHost
} from '../../providers/execution-host-provider-dispatch'
import { requireSshGitProvider } from '../../providers/ssh-git-dispatch'
import { getRepoExecutionHostId } from '../../../shared/execution-host'
import type { Repo } from '../../../shared/repo-types'

type LocalGitExecOptions = {
  cwd: string
  wslDistro?: string
}

export async function fetchGitLabMergeRequestHeadRef(
  repo: { path: string } & Pick<Repo, 'connectionId' | 'executionHostId'>,
  remote: string,
  mrIid: number,
  options: { localGitExecOptions?: LocalGitExecOptions } = {}
): Promise<string> {
  if (!isValidReviewHeadNumber(mrIid)) {
    throw new Error(`Invalid merge request iid: ${String(mrIid)}`)
  }
  if (!isSafeReviewHeadFetchRemote(remote)) {
    throw new Error('Merge request fetch remote must not start with "-".')
  }
  const route = resolveGitRouteForHost(getRepoExecutionHostId(repo))
  if (route.kind === 'runtime') {
    throw new ExecutionHostNotDispatchableError(route.hostId)
  }
  if (route.kind === 'ssh') {
    return requireSshGitProvider(route.connectionId).fetchGitLabMergeRequestHead(
      repo.path,
      remote,
      mrIid
    )
  }
  const localGitExecOptions = options.localGitExecOptions ?? { cwd: repo.path }
  const remoteComponent = await getReviewHeadRemoteComponent(remote, localGitExecOptions)
  // Return the written ref so callers do not recompute its identity.
  const localRef = gitlabMergeRequestHeadLocalRef(remoteComponent, mrIid)
  await gitExecFileAsync(
    ['fetch', '--no-tags', remote, `+refs/merge-requests/${mrIid}/head:${localRef}`],
    { ...localGitExecOptions, timeout: REVIEW_HEAD_FETCH_TIMEOUT_MS }
  )
  return localRef
}
