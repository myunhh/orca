import type { WebContents } from 'electron'
import { isDashboardPopoutRenderer } from './dashboard-popout-window'
import { isWorkbenchWindowRenderer } from './workbench-windows'

/** Companion windows mirror main-owned terminals and need text-only clipboard and selection authority. */
export function isCompanionWindowRenderer(sender: WebContents): boolean {
  return isDashboardPopoutRenderer(sender) || isWorkbenchWindowRenderer(sender)
}
