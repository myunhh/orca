import type { Store } from '../persistence/loading-store/store'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { KeybindingService } from '../keybindings/keybinding-service'
import { registerDashboardPopoutHandlers } from './dashboard-popout'
import { registerWorkspaceSpaceWindowHandlers } from './workspace-space/workspace-space-window'
import { registerTerminalPreviewHandlers } from './terminal-preview'
import { registerWorkbenchWindowHandlers } from './workbench-windows'

/** Windows beside the main one (dashboard, disk space, workbench) and their shared terminal mirror. */
export function registerCompanionWindowHandlers(
  store: Store,
  runtime: OrcaRuntimeService,
  keybindings: KeybindingService | undefined
): void {
  registerDashboardPopoutHandlers(store, keybindings)
  registerWorkspaceSpaceWindowHandlers(store)
  registerTerminalPreviewHandlers(runtime)
  registerWorkbenchWindowHandlers(store, keybindings)
}
