// Versioned-install plumbing for the remote relay: each (RELAY_VERSION + content-hash)
// bundle installs into its own immutable dir (like VS Code's ~/.vscode-server/bin/<commit>/)
// so an in-memory daemon never serves new clients off overwritten on-disk code.
//
// See: docs/ssh-relay-versioned-install-dirs.md

import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import type { SshConnection } from './connection/ssh-connection'
import { execCommand } from './remote-exec/remote-exec-command'
import { isUnconfirmedSshCommandTermination } from './remote-exec/remote-exec-command'
import { RELAY_INSTALL_LOCK_NAME } from '../../shared/relay-install-lock-name'
import { remoteInstallDirSegments } from './ssh-relay-install-namespace'
import {
  RELAY_INSTALL_MODEL,
  type RemoteInstallModel
} from '../managed-server/install/remote-install-model'
import {
  probeRemoteInstallCompleteCommand,
  removeRemoteTreeCommand,
  writeRemoteEmptyFileCommand
} from './ssh-remote-commands'
import {
  getRemoteHostPlatform,
  joinRemotePath,
  type RemoteHostPlatform,
  type RemotePathFlavor
} from './remote-host/ssh-remote-platform'
import { isSshSessionLimitError } from './connection/ssh-session-limit-error'

const INSTALL_COMPLETE_NAME = '.install-complete'
const DEFAULT_REMOTE_HOST = getRemoteHostPlatform('linux-x64')

type RelayInstalledProbeOptions = {
  rethrowSessionLimitErrors?: boolean
  signal?: AbortSignal
}

function execHostCommand(
  conn: SshConnection,
  host: RemoteHostPlatform,
  command: string,
  options?: { signal?: AbortSignal }
): Promise<string> {
  return execCommand(conn, command, {
    wrapCommand: host.commandDialect !== 'powershell',
    signal: options?.signal
  })
}

/**
 * Read the local relay's content-hashed version (e.g. "0.1.0+0a5fe134d020") from
 * `${localRelayDir}/.version`. Throws on missing/empty so the caller can't
 * silently fall back to a path where a stale-generation daemon may be running.
 */
export function readLocalFullVersion(localRelayDir: string): string {
  const versionFile = join(localRelayDir, '.version')
  if (!existsSync(versionFile)) {
    throw new Error(
      `Orca's local relay build is missing its version marker at ${versionFile}. ` +
        `This usually indicates a packaging or build problem; reinstall Orca.`
    )
  }
  const v = readFileSync(versionFile, 'utf-8').trim()
  if (!v) {
    throw new Error(
      `Orca's local relay version marker at ${versionFile} is empty. ` +
        `This usually indicates a packaging or build problem; reinstall Orca.`
    )
  }
  return v
}

/**
 * Compute the absolute remote install directory for a given content-hashed
 * version. The format is `${remoteHome}/${RELAY_REMOTE_DIR}/relay-${fullVersion}`.
 */
export function computeRemoteRelayDir(
  remoteHome: string,
  fullVersion: string,
  pathFlavor: RemotePathFlavor = 'posix'
): string {
  // Why: shell and SFTP-relative builders must derive the same validated segments or the namespaces diverge.
  return computeRemoteInstallDir(RELAY_INSTALL_MODEL, remoteHome, fullVersion, pathFlavor)
}

/** The model-parameterized form of `computeRemoteRelayDir`. */
export function computeRemoteInstallDir(
  model: RemoteInstallModel,
  remoteHome: string,
  fullVersion: string,
  pathFlavor: RemotePathFlavor = 'posix'
): string {
  const host =
    pathFlavor === 'windows'
      ? getRemoteHostPlatform('win32-x64')
      : getRemoteHostPlatform('linux-x64')
  return joinRemotePath(
    host,
    remoteHome,
    ...remoteInstallDirSegments(model, fullVersion, pathFlavor)
  )
}

/**
 * Probe for relay.js, its watcher, the managed-hook runtime, and the
 * completion sentinel. Any missing artifact forces a complete re-deploy.
 */
export async function isRelayAlreadyInstalled(
  conn: SshConnection,
  remoteRelayDir: string,
  host: RemoteHostPlatform = DEFAULT_REMOTE_HOST,
  options?: RelayInstalledProbeOptions
): Promise<boolean> {
  return isRemoteInstallComplete(conn, RELAY_INSTALL_MODEL, remoteRelayDir, host, options)
}

/** The model-parameterized form: each model probes for its own artifact list. */
export async function isRemoteInstallComplete(
  conn: SshConnection,
  model: RemoteInstallModel,
  remoteInstallDir: string,
  host: RemoteHostPlatform = DEFAULT_REMOTE_HOST,
  options?: RelayInstalledProbeOptions
): Promise<boolean> {
  const remoteRelayDir = remoteInstallDir
  try {
    const probe = await execHostCommand(
      conn,
      host,
      probeRemoteInstallCompleteCommand(host, remoteRelayDir, [
        ...model.requiredArtifacts(host),
        model.installCompleteFilename
      ]),
      { signal: options?.signal }
    )
    return probe.trim() === 'OK'
  } catch (err) {
    if (isUnconfirmedSshCommandTermination(err)) {
      throw err
    }
    options?.signal?.throwIfAborted()
    if (options?.rethrowSessionLimitErrors && isSshSessionLimitError(err)) {
      throw err
    }
    return false
  }
}

/**
 * Mark the install complete, then normally release the lock. Deploy keeps the
 * lock through first launch so cross-version GC can't move the dir before daemon
 * liveness is observable.
 */
export async function finalizeInstall(
  conn: SshConnection,
  remoteRelayDir: string,
  host: RemoteHostPlatform = DEFAULT_REMOTE_HOST,
  options?: { signal?: AbortSignal; releaseLock?: boolean }
): Promise<void> {
  const sentinel = joinRemotePath(host, remoteRelayDir, INSTALL_COMPLETE_NAME)
  const lock = joinRemotePath(host, remoteRelayDir, RELAY_INSTALL_LOCK_NAME)
  await execHostCommand(conn, host, writeRemoteEmptyFileCommand(host, sentinel), {
    signal: options?.signal
  })
  if (options?.releaseLock !== false) {
    await execHostCommand(conn, host, removeRemoteTreeCommand(host, lock), {
      signal: options?.signal
    }).catch((error) => {
      if (isUnconfirmedSshCommandTermination(error)) {
        throw error
      }
    })
  }
  options?.signal?.throwIfAborted()
}

/**
 * Release the install lock without writing the completion sentinel, leaving the
 * dir as a recoverable partial the next deploy re-installs.
 */
export async function abandonInstall(
  conn: SshConnection,
  remoteRelayDir: string,
  host: RemoteHostPlatform = DEFAULT_REMOTE_HOST
): Promise<void> {
  const lock = joinRemotePath(host, remoteRelayDir, RELAY_INSTALL_LOCK_NAME)
  await execHostCommand(conn, host, removeRemoteTreeCommand(host, lock)).catch((error) => {
    if (isUnconfirmedSshCommandTermination(error)) {
      throw error
    }
  })
}
