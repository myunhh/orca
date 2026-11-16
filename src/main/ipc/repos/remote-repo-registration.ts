import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { RuntimeStore } from '../../runtime/construction/runtime-store-contract'
import type { Repo } from '../../../shared/repo-types'
import { DEFAULT_REPO_BADGE_COLOR } from '../../../shared/repo-badge-color'
import { normalizeRuntimePathForComparison } from '../../../shared/cross-platform-path'
import { getRepoExecutionHostId, toSshExecutionHostId } from '../../../shared/execution-host'
import { getSshGitProvider, requireSshGitProvider } from '../../providers/ssh-git-dispatch'
import { requireSshFilesystemProvider } from '../../providers/ssh-filesystem-dispatch'
import { getActiveMultiplexer } from '../../ssh/targets/ssh-target-registry'
import { detectRepoLocalMetadata } from '../../repository-icons/repo-icon-autodetect'

const ResolvedHome = z.object({ resolvedPath: z.string().min(1) })

type RemoteRepoStore = Pick<RuntimeStore, 'getRepos' | 'addRepo' | 'getSshTargets'>

export async function addRemoteRepoFromPath(
  store: RemoteRepoStore,
  args: {
    connectionId: string
    remotePath: string
    displayName?: string
    kind?: 'git' | 'folder'
  }
): Promise<{ repo: Repo; alreadyExisted: boolean }> {
  const git = requireSshGitProvider(args.connectionId)
  const filesystem = requireSshFilesystemProvider(args.connectionId)
  const executionHostId = toSshExecutionHostId(args.connectionId)
  const kind = args.kind ?? 'git'
  let remotePath = args.remotePath
  if (remotePath === '~' || remotePath.startsWith('~/')) {
    const mux = getActiveMultiplexer(args.connectionId)
    if (!mux) {
      throw new Error('SSH connection changed; reconnect and try again')
    }
    remotePath = ResolvedHome.parse(
      await mux.request('session.resolveHome', { path: remotePath })
    ).resolvedPath
  }
  if (kind === 'git') {
    const check = await git.isGitRepoAsync(remotePath)
    if (!check.isRepo || !check.rootPath) {
      throw new Error(`Not a valid git repository: ${args.remotePath}`)
    }
    remotePath = check.rootPath
  } else {
    const info = await filesystem.stat(remotePath)
    if (info.type !== 'directory') {
      throw new Error(`Path is not a folder: ${args.remotePath}`)
    }
    remotePath = await filesystem.realpath(remotePath)
  }
  const pathKey = normalizeRuntimePathForComparison(remotePath)
  const findExisting = () =>
    store
      .getRepos()
      .find(
        (repo) =>
          getRepoExecutionHostId(repo) === executionHostId &&
          normalizeRuntimePathForComparison(repo.path) === pathKey
      )
  const existing = findExisting()
  if (existing) {
    return { repo: existing, alreadyExisted: true }
  }
  const detected = await detectRepoLocalMetadata({ repoPath: remotePath, kind, executionHostId })
  if (getSshGitProvider(args.connectionId) !== git) {
    throw new Error('SSH connection changed; reconnect and try again')
  }
  const raceWinner = findExisting()
  if (raceWinner) {
    return { repo: raceWinner, alreadyExisted: true }
  }
  const target = store.getSshTargets?.().find((target) => target.id === args.connectionId)
  const folderName =
    remotePath
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .at(-1) || remotePath
  const repo: Repo = {
    id: randomUUID(),
    path: remotePath,
    displayName:
      args.displayName?.trim() ||
      ((args.remotePath === '~' || args.remotePath === '~/') && target?.label) ||
      folderName,
    badgeColor: DEFAULT_REPO_BADGE_COLOR,
    ...detected,
    addedAt: Date.now(),
    kind,
    connectionId: args.connectionId,
    executionHostId,
    ...(kind === 'git'
      ? {
          externalWorktreeVisibilityLegacy: false,
          projectHostSetupMethod: 'imported-existing-folder'
        }
      : {})
  }
  store.addRepo(repo)
  getActiveMultiplexer(args.connectionId)?.notify('session.registerRoot', { rootPath: remotePath })
  return { repo, alreadyExisted: false }
}
