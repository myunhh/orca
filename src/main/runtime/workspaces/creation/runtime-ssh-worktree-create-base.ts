import type { Repo } from '../../../../shared/repo-types'
import type { WorktreeCreateBaseFallback } from '../../../../shared/worktree/create-types'
import { resolveDefaultBaseRefViaExec } from '../../../../shared/git/refs/git-default-base-ref'
import { resolveWorktreeCreateBase } from '../../../workspaces/creation/worktree-create-base'
import type { SshGitProvider } from '../../../providers/ssh-git-provider'
import type { RemoteTrackingBase } from '../../repositories/runtime-remote-fetch-controller'
import type { WorktreeCreateTimingRecorder } from '../../../workspaces/creation/worktree-create-timing'

export async function sshCommitRef(
  provider: SshGitProvider,
  repoPath: string,
  ref: string
): Promise<string | null> {
  // --revs-only returns an empty result for a missing ref without conflating transport failure with absence.
  const { stdout } = await provider.exec(
    ['rev-parse', '--revs-only', '--end-of-options', `${ref}^{commit}`],
    repoPath
  )
  return stdout.trim() || null
}

async function trackingBase(
  provider: SshGitProvider,
  repoPath: string,
  base: string
): Promise<RemoteTrackingBase | null> {
  const { stdout } = await provider.exec(['remote'], repoPath)
  const short = base.replace(/^refs\/remotes\//, '')
  const remote = stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .find((candidate) => short.startsWith(`${candidate}/`))
  if (!remote) {
    return null
  }
  const branch = short.slice(remote.length + 1)
  return branch
    ? { remote, branch, ref: `refs/remotes/${remote}/${branch}`, base: `${remote}/${branch}` }
    : null
}

export async function resolveSshWorktreeCreateBase(args: {
  provider: SshGitProvider
  repo: Repo
  requestedBaseBranch?: string
  allowLocalBaseFallback?: boolean
  timing: WorktreeCreateTimingRecorder
}): Promise<{
  baseBranch: string
  remoteTrackingBase: RemoteTrackingBase | null
  baseFallback?: WorktreeCreateBaseFallback
}> {
  const { provider, repo } = args
  const baseBranch = await resolveWorktreeCreateBase({
    requestedBaseBranch: args.requestedBaseBranch,
    repoWorktreeBaseRef: repo.worktreeBaseRef,
    resolveDefaultBaseRef: () =>
      resolveDefaultBaseRefViaExec((argv) => provider.exec(argv, repo.path)),
    isBaseUsable: async (candidate) => {
      const tracking = await trackingBase(provider, repo.path, candidate)
      return Boolean(await sshCommitRef(provider, repo.path, tracking?.ref ?? candidate))
    }
  })
  if (!baseBranch) {
    throw new Error(
      'Could not resolve a default base ref for this repo. Pass an explicit --base and try again.'
    )
  }
  const remoteTrackingBase = await trackingBase(provider, repo.path, baseBranch)
  if (!remoteTrackingBase) {
    return { baseBranch, remoteTrackingBase: null }
  }
  const hadTrackingRef = Boolean(await sshCommitRef(provider, repo.path, remoteTrackingBase.ref))
  if (!hadTrackingRef && (await sshCommitRef(provider, repo.path, `refs/heads/${baseBranch}`))) {
    return { baseBranch, remoteTrackingBase: null }
  }
  try {
    await args.timing.time('refresh_base_ref', () =>
      provider.fetchRemoteTrackingRef(
        repo.path,
        remoteTrackingBase.remote,
        remoteTrackingBase.branch,
        remoteTrackingBase.ref
      )
    )
  } catch (error) {
    if (!hadTrackingRef) {
      if (
        args.allowLocalBaseFallback &&
        (await sshCommitRef(provider, repo.path, `refs/heads/${remoteTrackingBase.branch}`))
      ) {
        return {
          baseBranch: remoteTrackingBase.branch,
          remoteTrackingBase: null,
          baseFallback: {
            requestedRef: remoteTrackingBase.base,
            localRef: remoteTrackingBase.branch
          }
        }
      }
      throw error
    }
  }
  if (!(await sshCommitRef(provider, repo.path, remoteTrackingBase.ref))) {
    throw new Error(`Base ref "${baseBranch}" was not found after fetching.`)
  }
  return { baseBranch, remoteTrackingBase }
}
