import type { SshRelaySession } from '../../ssh/ssh-relay-session'
import {
  setSshActiveMultiplexerResolver,
  setSshHostHomeDirectoryResolver
} from '../../ssh/targets/ssh-target-registry'

export const activeSessions = new Map<string, SshRelaySession>()

setSshActiveMultiplexerResolver(
  (connectionId) => activeSessions.get(connectionId)?.getMux() ?? undefined
)

export function getActiveSshHostHomeDirectory(targetId: string): string | null {
  return activeSessions.get(targetId)?.getRemoteHomeDirectory() ?? null
}

setSshHostHomeDirectoryResolver(getActiveSshHostHomeDirectory)