import type { DirectSshAuthority, SshConnectionState } from '../../../shared/ssh-types'

export type DirectSshConnectedStateOrigin = 'push' | 'initial-hydration'

export function directSshAuthorityFromConnectionState(
  targetId: string,
  state: SshConnectionState
): DirectSshAuthority | null {
  if (
    state.targetId !== targetId ||
    state.status !== 'connected' ||
    !state.providerEpoch ||
    state.connectionGeneration === undefined ||
    state.managedServer?.kind === 'managed'
  ) {
    return null
  }
  return {
    targetId,
    providerEpoch: state.providerEpoch,
    connectionGeneration: state.connectionGeneration
  }
}

export function registerDirectSshWakeRouting(deps: {
  getConnectionStates: () => Iterable<readonly [string, SshConnectionState]>
  wakeAuthority: (authority: DirectSshAuthority) => void
  onSystemResumed?: (callback: () => void) => () => void
}): () => void {
  const wake = (): void => {
    for (const [targetId, state] of deps.getConnectionStates()) {
      const authority = directSshAuthorityFromConnectionState(targetId, state)
      if (authority) {
        deps.wakeAuthority(authority)
      }
    }
  }
  window.addEventListener('online', wake)
  const unsubscribeSystemResumed = deps.onSystemResumed?.(wake)
  return () => {
    window.removeEventListener('online', wake)
    unsubscribeSystemResumed?.()
  }
}
