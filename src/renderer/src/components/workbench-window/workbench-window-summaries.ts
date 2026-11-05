import type { AppState } from '@/store/types'
import { findUnifiedTab } from './workbench-tab-eligibility'
import { workbenchTabLabel } from './workbench-tab-label'

type SummaryState = Pick<
  AppState,
  'detachedWindowIdByTabId' | 'unifiedTabsByWorktree' | 'tabsByWorktree' | 'openFiles' | 'settings'
>

export type WorkbenchWindowSummary = {
  windowId: string
  firstTabLabel: string | null
  tabCount: number
}

/** Open workbench windows as the main renderer knows them: every window shows at least one detached tab. */
export function summarizeWorkbenchWindows(state: SummaryState): WorkbenchWindowSummary[] {
  const byWindowId = new Map<string, WorkbenchWindowSummary>()
  for (const [tabId, windowId] of Object.entries(state.detachedWindowIdByTabId)) {
    let summary = byWindowId.get(windowId)
    if (!summary) {
      summary = { windowId, firstTabLabel: null, tabCount: 0 }
      byWindowId.set(windowId, summary)
    }
    summary.tabCount += 1
    if (summary.firstTabLabel === null) {
      const tab = findUnifiedTab(state, tabId)
      summary.firstTabLabel = tab ? workbenchTabLabel(state, tab) : null
    }
  }
  return [...byWindowId.values()]
}

/** Tabs a window shows or will show; a full window would silently drop more. */
export function countWorkbenchWindowTabs(
  detachedWindowIdByTabId: AppState['detachedWindowIdByTabId'],
  windowId: string
): number {
  return Object.values(detachedWindowIdByTabId).filter((id) => id === windowId).length
}
