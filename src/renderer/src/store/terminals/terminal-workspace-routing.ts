import type { AppState } from '../types'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'
import { isWslUncPath } from '../../../../shared/wsl-paths'
import type { ProjectExecutionRuntimeResolution } from '../../../../shared/execution-host/project-execution-runtime'
import { resolveLocalWindowsTerminalShellOverrideForTab } from '../../../../shared/local-windows-terminal-runtime'
import { WINDOWS_GIT_BASH_SHELL } from '../../../../shared/windows-terminal-shell'
import { getResolvedExecutionHostIdForWorktree } from '@/lib/workspace/ownership/resolved-worktree-execution-host'
import { getSshTargetIdForExecutionHost } from '../../../../shared/execution-host'
import { getRepoExecutionHostId } from '../../../../shared/execution-host'
import { getRepoIdFromWorktreeId } from '../../../../shared/worktree/id'
import { getIndexedWorktreeMap } from '../slices/worktrees/listing/worktree-catalog-index'
import {
  selectFolderWorkspaces,
  selectWorktreesByRepo
} from '../workspaces/catalog/workspace-record-fields'

export function isWindowsRendererRuntime(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows')
}

export function isAllowedRemoteWindowsTerminalShell(shell: string | undefined): boolean {
  return (
    shell === 'powershell.exe' ||
    shell === 'pwsh.exe' ||
    shell === 'cmd.exe' ||
    shell === 'wsl.exe' ||
    shell === WINDOWS_GIT_BASH_SHELL
  )
}

export function resolveCreatedTabShellOverride(
  explicitShellOverride: string | undefined,
  defaultWindowsShell: string | undefined,
  isRemoteWorktree: boolean,
  remotePlatform: NodeJS.Platform | null,
  isWslWorktree: boolean,
  projectRuntime: ProjectExecutionRuntimeResolution | undefined
): string | undefined {
  if (isRemoteWorktree) {
    if (remotePlatform === 'win32' && isAllowedRemoteWindowsTerminalShell(explicitShellOverride)) {
      return explicitShellOverride
    }
    return undefined
  }
  if (isWindowsRendererRuntime()) {
    return resolveLocalWindowsTerminalShellOverrideForTab({
      explicitShellOverride,
      defaultWindowsShell,
      isWslWorktree,
      projectRuntime
    })
  }
  if (explicitShellOverride !== undefined) {
    return explicitShellOverride
  }
  return undefined
}

export function worktreeUsesWslPath(
  state: Pick<AppState, 'folderWorkspaces' | 'worktreesByRepo'>,
  worktreeId: string
): boolean {
  const parsed = parseWorkspaceKey(worktreeId)
  if (parsed?.type === 'folder') {
    const folderWorkspace = selectFolderWorkspaces(state).find(
      (workspace) => workspace.id === parsed.folderWorkspaceId
    )
    return folderWorkspace ? isWslUncPath(folderWorkspace.folderPath) : false
  }
  const worktree = getIndexedWorktreeMap(selectWorktreesByRepo(state)).get(worktreeId)
  return worktree ? isWslUncPath(worktree.path) : false
}

export function worktreeUsesRemoteConnection(
  state: Pick<AppState, 'folderWorkspaces' | 'projectGroups' | 'repos' | 'worktreesByRepo'>,
  worktreeId: string
): boolean {
  return getRemoteConnectionIdForWorktree(state, worktreeId) !== null
}

export function getRemoteConnectionIdForWorktree(
  state: Pick<AppState, 'folderWorkspaces' | 'projectGroups' | 'repos' | 'worktreesByRepo'>,
  worktreeId: string
): string | null {
  const resolvedHost = getResolvedExecutionHostIdForWorktree(state, worktreeId)
  if (resolvedHost) {
    return getSshTargetIdForExecutionHost(resolvedHost)
  }
  // Before listings hydrate, only a unique persisted owner can route a saved SSH terminal.
  const repoId = getRepoIdFromWorktreeId(worktreeId)
  const hosts = new Set(
    state.repos.filter((repo) => repo.id === repoId).map(getRepoExecutionHostId)
  )
  return hosts.size === 1 ? getSshTargetIdForExecutionHost([...hosts][0]) : null
}
