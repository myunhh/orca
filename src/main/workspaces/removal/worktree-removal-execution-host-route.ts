/** Never route an unavailable remote host to a same-named local path. */

import {
  parseExecutionHostId,
  type ExecutionHostId,
  type LOCAL_EXECUTION_HOST_ID
} from '../../../shared/execution-host'
import {
  CLIENT_REMOVAL_HOME,
  executionHostRemovalHome,
  type WorktreeRemovalHomeAuthority
} from './worktree-removal-home-guard'
import {
  ExecutionHostNotDispatchableError,
  resolveGitRouteForHost
} from '../../providers/execution-host-provider-dispatch'
import { requireSshGitProvider } from '../../providers/ssh-git-dispatch'
import { getSshFilesystemProvider } from '../../providers/ssh-filesystem-dispatch'
import type { SshGitProvider } from '../../providers/ssh-git-provider'
import type { IFilesystemProvider } from '../../providers/filesystem-provider-contract'
import { getActiveSshHostHomeDirectory } from '../../ssh/targets/ssh-target-registry'

export type WorktreeRemovalRoute =
  | { kind: 'local'; hostId: typeof LOCAL_EXECUTION_HOST_ID }
  | {
      kind: 'ssh'
      hostId: `ssh:${string}`
      connectionId: string
      provider: SshGitProvider
      fsProvider: IFilesystemProvider | null
    }

export function resolveWorktreeRemovalRoute(hostId: ExecutionHostId): WorktreeRemovalRoute {
  const route = resolveGitRouteForHost(hostId)
  switch (route.kind) {
    case 'local':
      return { kind: 'local', hostId: route.hostId }
    case 'runtime':
      throw new ExecutionHostNotDispatchableError(route.hostId)
    case 'ssh':
      return {
        kind: 'ssh',
        hostId: route.hostId,
        connectionId: route.connectionId,
        provider: requireSshGitProvider(route.connectionId),
        fsProvider: getSshFilesystemProvider(route.connectionId) ?? null
      }
  }
}

export function resolveWorktreeRemovalHome(
  route: WorktreeRemovalRoute
): WorktreeRemovalHomeAuthority {
  return resolveWorktreeRemovalHomeForHost(route.hostId)
}

/** A nullable connectionId cannot establish that the client owns the filesystem or its home. */
export function resolveWorktreeRemovalHomeForHost(
  hostId: ExecutionHostId
): WorktreeRemovalHomeAuthority {
  const parsed = parseExecutionHostId(hostId)
  switch (parsed?.kind) {
    case 'local':
      return CLIENT_REMOVAL_HOME
    // Only a local host may use this client's home as deletion authority.
    case 'ssh':
      return executionHostRemovalHome(getActiveSshHostHomeDirectory(parsed.targetId))
    case 'runtime':
    case undefined:
      return executionHostRemovalHome(null)
  }
}
