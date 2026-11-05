import type { WorkbenchCommand } from '../../../../shared/workbench-window/workbench-window-types'

/** Ask the main window, which owns every tab, to act; the next snapshot shows the result. */
export function sendWorkbenchCommand(command: WorkbenchCommand): void {
  void window.api.workbenchWindows?.sendCommand(command)
}
