import { toast } from 'sonner'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { translate } from '@/i18n/i18n'
import { canShowTabInWorkbenchWindow, findUnifiedTab } from './workbench-tab-eligibility'

/** The tab a group should show once `leavingTabIds` move out: newest MRU entry first, then the nearest neighbor. */
function successorInGroup(
  state: AppState,
  unifiedTabId: string,
  leavingTabIds: ReadonlySet<string>
): string | null {
  const tab = findUnifiedTab(state, unifiedTabId)
  const group = tab
    ? (state.groupsByWorktree[tab.worktreeId] ?? []).find((g) => g.id === tab.groupId)
    : undefined
  if (!tab || !group || group.activeTabId !== unifiedTabId) {
    return null
  }
  const stays = (id: string): boolean =>
    !leavingTabIds.has(id) &&
    state.detachedWindowIdByTabId[id] === undefined &&
    group.tabOrder.includes(id)
  const recent = (group.recentTabIds ?? []).toReversed().find(stays)
  if (recent) {
    return recent
  }
  const index = group.tabOrder.indexOf(unifiedTabId)
  const after = group.tabOrder.slice(index + 1).find(stays)
  return after ?? group.tabOrder.slice(0, Math.max(index, 0)).toReversed().find(stays) ?? null
}

/** Show tabs in a workbench window and select what each group shows next; the tabs stay in their groups. */
export function assignTabsToWorkbenchWindow(
  unifiedTabIds: readonly string[],
  windowId: string
): void {
  const state = useAppStore.getState()
  const leaving = new Set(unifiedTabIds)
  const successors = unifiedTabIds
    .map((tabId) => successorInGroup(state, tabId, leaving))
    .filter((tabId): tabId is string => tabId !== null)
  state.assignTabsToWorkbenchWindow(unifiedTabIds, windowId)
  for (const successor of successors) {
    useAppStore.getState().activateTab(successor, { recordFocus: false })
  }
}

export async function moveTabsToNewWorkbenchWindow(
  unifiedTabIds: readonly string[]
): Promise<void> {
  const state = useAppStore.getState()
  const movable = unifiedTabIds.filter((tabId) => canShowTabInWorkbenchWindow(state, tabId))
  const api = window.api.workbenchWindows
  if (movable.length === 0 || !api) {
    return
  }
  try {
    const opened = await api.open(movable)
    if (!opened) {
      throw new Error('workbench window refused')
    }
    assignTabsToWorkbenchWindow(movable, opened.windowId)
  } catch {
    toast.error(
      translate(
        'components.workbench.window.workbench.tab.move.openFailed',
        'Could not open a new window'
      )
    )
  }
}
