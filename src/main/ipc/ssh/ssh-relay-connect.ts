import type { SshTarget, SshConnectionState } from '../../../shared/ssh-types'
import { getAppEnvironment } from '../../../shared/app-environment'
import { getOrcadSshDeployment } from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import { listEnvironments } from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import { SshRelaySession } from '../../ssh/ssh-relay-session'
import { allowsDirectSshRelay } from '../../ssh/targets/ssh-target-runtime-ownership'
import { clearSshHostServerStatus } from '../../ssh/host-server/ssh-host-server-status'
import {
  adoptSshConnection,
  runAttributedToSshOwner
} from '../../ssh/connection/ssh-connection-attribution'
import { rotateSshProviderAuthority } from '../../ssh/connection/authority/ssh-provider-authority'
import { createCancelledConnectAttemptError } from '../../ssh/connection/reconnect/ssh-connect-attempt-cancellation'
import { assertSshConnectsNotFenced, isCurrentConnectAttempt } from './ssh-connect-attempt-registry'
import {
  connectionManager,
  currentRuntime,
  getCurrentMainWindow,
  persistedStore,
  portForwardManager
} from './ssh-ipc-context'
import { activeSessions } from './ssh-active-relay-sessions'
import { configureRelaySessionCallbacks } from './ssh-relay-session-callbacks'
import { relayGracePeriodForTarget } from './ssh-connection-state-callbacks'
import { clearRelayLostBackoff } from './ssh-relay-lost-backoff'
import {
  broadcastDetectedPortsFromCurrentWindow,
  clearRelayStateOverride,
  getPublicSshState,
  publishRelayOverride
} from './ssh-renderer-broadcast'
import { abandonDecisionTransport } from './ssh-session-teardown'

/** Existing managed ownership is never reversed merely by installing a relay-capable desktop. */
export function shouldConnectDirectSshRelay(target: SshTarget): boolean {
  if (!allowsDirectSshRelay(target)) {
    return false
  }
  const linked = listEnvironments(getAppEnvironment().getPath('userData')).find(
    (environment) => getOrcadSshDeployment(environment)?.sshTargetId === target.id
  )
  if (linked && getOrcadSshDeployment(linked)?.sshTargetGeneration !== target.generation) {
    throw new Error(
      'An existing Orca server owns this SSH registration. Reconnect that server or explicitly migrate its workspaces before using a direct relay.'
    )
  }
  return linked === undefined
}

export async function connectRelayTarget(
  target: SshTarget,
  replacePendingTransport: boolean
): Promise<SshConnectionState> {
  if (!connectionManager || !persistedStore || !portForwardManager) {
    throw new Error('SSH relay infrastructure is unavailable')
  }
  const targetId = target.id
  const previous = activeSessions.get(targetId)
  const readyState = getPublicSshState(targetId)
  if (
    !replacePendingTransport &&
    previous?.getState() === 'ready' &&
    readyState?.status === 'connected'
  ) {
    return readyState
  }

  const authority = rotateSshProviderAuthority(targetId)
  const assertCurrent = (): void => {
    assertSshConnectsNotFenced()
    if (!isCurrentConnectAttempt(targetId, authority)) {
      throw createCancelledConnectAttemptError()
    }
  }
  if (previous) {
    activeSessions.delete(targetId)
    publishRelayOverride(getCurrentMainWindow, targetId, 'reconnecting', null, 0)
    try {
      await previous.detachAndPersist()
    } catch (error) {
      if (isCurrentConnectAttempt(targetId, authority)) {
        publishRelayOverride(
          getCurrentMainWindow,
          targetId,
          'error',
          error instanceof Error ? error.message : String(error),
          0
        )
      }
      throw error
    }
    assertCurrent()
  }
  if (replacePendingTransport) {
    await connectionManager.disconnect(targetId)
    assertCurrent()
  }
  clearSshHostServerStatus(targetId)
  clearRelayLostBackoff(targetId)
  clearRelayStateOverride(targetId)
  assertCurrent()
  const session = new SshRelaySession(
    targetId,
    getCurrentMainWindow,
    persistedStore,
    portForwardManager,
    currentRuntime,
    broadcastDetectedPortsFromCurrentWindow
  )
  configureRelaySessionCallbacks(session)
  activeSessions.set(targetId, session)
  const owner = Symbol(targetId)
  try {
    const connection = await runAttributedToSshOwner(owner, () =>
      connectionManager!.connect(target)
    )
    assertCurrent()
    publishRelayOverride(getCurrentMainWindow, targetId, 'deploying-relay', null, 0)
    await session.establish(connection, relayGracePeriodForTarget(target))
    assertCurrent()
    if (activeSessions.get(targetId) !== session || session.getState() !== 'ready') {
      throw new Error('SSH relay did not finish establishing its providers')
    }
    adoptSshConnection(connection, owner)
    const state = getPublicSshState(targetId)
    if (!state) {
      throw createCancelledConnectAttemptError()
    }
    return state
  } catch (error) {
    if (activeSessions.get(targetId) === session) {
      activeSessions.delete(targetId)
    }
    await session.detachAndPersist().catch((detachError: unknown) => {
      console.warn(`[ssh] Could not persist relay detach for ${targetId}:`, detachError)
    })
    await abandonDecisionTransport(targetId, owner, authority)
    if (isCurrentConnectAttempt(targetId, authority)) {
      clearRelayLostBackoff(targetId)
      publishRelayOverride(
        getCurrentMainWindow,
        targetId,
        'error',
        error instanceof Error ? error.message : String(error),
        0
      )
    }
    throw error
  }
}
