import { powerMonitor } from 'electron'
import { recoverOrcadManagedTunnelsAfterHostResume } from '../../managed-server/lifecycle/orcad-managed-tunnel'
import {
  getSshConnectionManager,
  getSshTargetRegistryStore
} from '../../ssh/targets/ssh-target-registry'
import { errorMessage } from '../../../shared/error-message'
import type { SshRelaySession } from '../../ssh/ssh-relay-session'
import { activeSessions } from './ssh-active-relay-sessions'

let powerMonitorUnsubscribe: (() => void) | null = null
let registeredGetUserDataPath: (() => string) | undefined

// macOS can wake before networking; allow one retry before declaring a link dead (#7773).
const RESUME_PROBE_TIMEOUT_MS = 5_000
const RESUME_PROBE_ATTEMPTS = 2

async function relayLinkAliveAfterResume(session: SshRelaySession): Promise<boolean> {
  const plainSsh = session.getPlainSshSession()
  const mux = session.getMux()
  if (!plainSsh && (!mux || mux.isDisposed())) {
    return false
  }
  for (let attempt = 0; attempt < RESUME_PROBE_ATTEMPTS; attempt++) {
    const alive = plainSsh
      ? await plainSsh.probeTransport(RESUME_PROBE_TIMEOUT_MS)
      : mux
        ? await mux.probeLiveness(RESUME_PROBE_TIMEOUT_MS)
        : false
    if (alive) {
      return true
    }
  }
  return false
}

async function recoverRelayAfterResume(targetId: string, session: SshRelaySession): Promise<void> {
  const manager = getSshConnectionManager()
  const connection = manager?.getConnection(targetId)
  if (!manager || !connection || manager.getState(targetId)?.status !== 'connected') {
    return
  }
  const alive = await relayLinkAliveAfterResume(session)
  if (activeSessions.get(targetId) !== session || manager.getConnection(targetId) !== connection) {
    return
  }
  if (alive) {
    session.setGracePeriod(
      getSshTargetRegistryStore()?.getTarget(targetId)?.relayGracePeriodSeconds
    )
  } else {
    await manager.reconnect(targetId)
  }
}

/** Real wake/unlock/online signals refresh a reconnect budget spent during silent macOS dark wakes. */
export function retrySshConnectionsAfterNetworkReturn(): void {
  const restarted = getSshConnectionManager()?.retryStalledReconnects() ?? []
  if (restarted.length > 0) {
    console.warn(`[ssh] Retrying ${restarted.length} stalled SSH reconnect(s) after wake/network`)
  }
  for (const [targetId, session] of activeSessions) {
    void recoverRelayAfterResume(targetId, session).catch((error: unknown) => {
      console.warn(`[ssh] Failed to recover relay ${targetId} after network return:`, error)
    })
  }
  const getUserDataPath = registeredGetUserDataPath
  if (!getUserDataPath) {
    return
  }
  // Probe transports that still appear connected after wake; keepalive may not detect them yet.
  void recoverOrcadManagedTunnelsAfterHostResume(getUserDataPath(), {
    attempts: RESUME_PROBE_ATTEMPTS,
    timeoutMs: RESUME_PROBE_TIMEOUT_MS
  }).catch((err) => {
    console.warn(
      `[ssh] Failed to recover a managed Orca tunnel after system resume: ${errorMessage(err)}`
    )
  })
}

export function registerPowerMonitorReconnect(getUserDataPath?: () => string): void {
  powerMonitorUnsubscribe?.()
  registeredGetUserDataPath = getUserDataPath
  const onResume = (): void => retrySshConnectionsAfterNetworkReturn()
  const onSuspend = (): void => {
    for (const session of activeSessions.values()) {
      session.prepareForHostSleep()
    }
  }
  powerMonitor.on('suspend', onSuspend)
  powerMonitor.on('resume', onResume)
  // macOS/Windows lock without sleep can still drop VPN routes.
  powerMonitor.on('unlock-screen', onResume)
  powerMonitorUnsubscribe = () => {
    powerMonitor.off('resume', onResume)
    powerMonitor.off('unlock-screen', onResume)
    powerMonitor.off('suspend', onSuspend)
  }
}

export function unregisterPowerMonitorReconnect(): void {
  powerMonitorUnsubscribe?.()
  powerMonitorUnsubscribe = null
  registeredGetUserDataPath = undefined
}
