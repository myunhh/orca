import type { SshConnection } from './connection/ssh-connection'
import { gcOldRemoteInstallVersions } from '../managed-server/install/remote-install-gc'
import { RELAY_INSTALL_MODEL } from '../managed-server/install/remote-install-model'
import { RELAY_REMOTE_DIR } from '../managed-server/install/remote-install-root'
import { execHostCommand } from './remote-exec/remote-host-exec'
import { isUnconfirmedSshCommandTermination } from './remote-exec/remote-exec-command'
import { gcRelayNativeDepsCache } from './ssh-relay-native-deps-cache-gc'
import { findPreviousRemoteInstall } from './remote-install-previous-version'
import {
  parseRelayVersionDirLiveness,
  relayVersionDirLivenessCommand
} from './relay-version-dir-liveness'
import { windowsRelayPipePathsForSocketName } from './ssh-relay-endpoints'
import type { RelayEndpointVerdict } from './ssh-relay-endpoint-incumbent'
import {
  getRemoteHostPlatform,
  isWindowsRemoteHost,
  joinRemotePath,
  remoteBasename,
  type RemoteHostPlatform
} from './remote-host/ssh-remote-platform'

const DEFAULT_REMOTE_HOST = getRemoteHostPlatform('linux-x64')

export async function gcOldRelayVersions(
  conn: SshConnection,
  remoteHome: string,
  currentDirAbsPath: string,
  host: RemoteHostPlatform = DEFAULT_REMOTE_HOST,
  options?: {
    windowsNodePath?: string
    windowsSockNames?: string[]
    /** Host Node that runs the connect probe once a recorded relay PID is dead. */
    nodePath?: string
    /**
     * Cache entries this connection depends on, whether or not it links to them. Also the gate:
     * a caller that could not compute a key is not using the shared-cache model on this host, and
     * a pass only ever collects what its own model created (see `remote-install-model.ts`).
     */
    nativeDepsCacheKeys?: readonly string[]
  }
): Promise<void> {
  await gcOldRemoteInstallVersions(conn, RELAY_INSTALL_MODEL, remoteHome, currentDirAbsPath, host, {
    ...options,
    resolveExtraPinnedDirNames: async () => {
      const previous = await findPreviousRemoteInstall(
        conn,
        host,
        joinRemotePath(host, remoteHome, RELAY_REMOTE_DIR),
        RELAY_INSTALL_MODEL,
        remoteBasename(currentDirAbsPath, host)
      )
      // Why null rather than a guess: without the order, any candidate could be the previous build.
      if (previous.state !== 'ok') {
        return null
      }
      return previous.dirName ? [previous.dirName] : []
    },
    isDirLive: async (dir) =>
      (await probeRelayVersionDirLiveness(conn, dir, host, options)) !== 'exited'
  })
  // Why after and not before: version-dir removal is what turns a cache entry unreferenced, so
  // running it second lets one pass reclaim both instead of leaving the tree for the next connect.
  if (options?.nativeDepsCacheKeys?.length) {
    await gcRelayNativeDepsCache(conn, host, remoteHome, {
      pinnedKeys: options.nativeDepsCacheKeys
    }).catch((err) => {
      if (isUnconfirmedSshCommandTermination(err)) {
        throw err
      }
    })
  }
}

/** GC deletes a relay version dir only on `exited`; see relay-version-dir-liveness.ts. */
export async function probeRelayVersionDirLiveness(
  conn: SshConnection,
  dir: string,
  host: RemoteHostPlatform = DEFAULT_REMOTE_HOST,
  options?: {
    windowsNodePath?: string
    windowsSockNames?: string[]
    nodePath?: string
  }
): Promise<RelayEndpointVerdict> {
  try {
    const windows =
      isWindowsRemoteHost(host) && options?.windowsNodePath
        ? {
            nodePath: options.windowsNodePath,
            pipePaths: (options.windowsSockNames ?? []).flatMap((sockName) =>
              windowsRelayPipePathsForSocketName(host, dir, sockName)
            )
          }
        : undefined
    const out = await execHostCommand(
      conn,
      host,
      relayVersionDirLivenessCommand(host, dir, { nodePath: options?.nodePath, windows })
    )
    return parseRelayVersionDirLiveness(out)
  } catch (err) {
    if (isUnconfirmedSshCommandTermination(err)) {
      throw err
    }
    // Why: an unanswered probe observes nothing; it never authorizes deletion.
    return 'unverifiable'
  }
}
