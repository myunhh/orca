import type { CreateWorktreeResult } from '../../../../shared/worktree/create-types'
import type { RuntimeLocalWorktreeTerminalStartupResult } from '../startup/runtime-local-worktree-terminal-startup'
import type { RuntimeManagedWorktreeCreateArgs } from './runtime-managed-worktree-create-types'
import {
  buildRuntimeSetupReceipt,
  type RuntimePreparedWorktreeSetup
} from './runtime-local-worktree-setup'

export function buildRuntimeWorktreeStartupResult(args: {
  request: Pick<RuntimeManagedWorktreeCreateArgs, 'awaitTerminalProvisioning'>
  prepared: RuntimePreparedWorktreeSetup
  started: RuntimeLocalWorktreeTerminalStartupResult
}): Pick<
  CreateWorktreeResult,
  'setup' | 'setupReceipt' | 'defaultTabs' | 'setupTrustMismatch' | 'warning' | 'startupTerminal'
> {
  const { request, prepared, started } = args
  return {
    ...(started.returnedSetup ? { setup: started.returnedSetup } : {}),
    ...(request.awaitTerminalProvisioning
      ? {
          setupReceipt: buildRuntimeSetupReceipt(
            prepared,
            started.didSpawnSetup,
            started.setupTerminalHandle
          )
        }
      : {}),
    ...(prepared.defaultTabs ? { defaultTabs: prepared.defaultTabs } : {}),
    ...(prepared.setupTrustMismatch ? { setupTrustMismatch: prepared.setupTrustMismatch } : {}),
    ...(started.warning ? { warning: started.warning } : {}),
    ...(started.didSpawnStartup && started.startupTerminalHandle
      ? {
          startupTerminal: {
            spawned: true,
            handle: started.startupTerminalHandle,
            ...(started.startupTerminalTabId ? { tabId: started.startupTerminalTabId } : {}),
            ...(started.startupTerminalPaneKey ? { paneKey: started.startupTerminalPaneKey } : {}),
            ...(started.startupTerminalPtyId ? { ptyId: started.startupTerminalPtyId } : {}),
            surface: 'background' as const
          }
        }
      : {})
  }
}
