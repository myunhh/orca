import type { AppState } from '@/store/types'
import type { Tab } from '../../../../../shared/tab-types'
import type { WorkbenchAdoptableTab } from '../../../../../shared/workbench-window/workbench-window-types'
import { WORKBENCH_MAX_ADOPTABLE_TABS } from '../../../../../shared/workbench-window/workbench-window-types'
import { isImageDropPath } from '../../../../../shared/image-path-paste'
import { getNotificationWorkspaceLabels } from '@/components/terminal-pane/terminal-notification-state'
import { isPairedWebClientWindow } from '@/lib/desktop-window-chrome'
import { isWorkbenchEligibleTab } from '../workbench-tab-eligibility'
import {
  findTerminalTabRow,
  workbenchTabLabel,
  workbenchTerminalAgentState
} from '../workbench-tab-label'

/** Tabs in visual strip order: groups first, then any tab no group lists. */
function orderedWorktreeTabs(state: AppState, worktreeId: string, tabs: readonly Tab[]): Tab[] {
  const byId = new Map(tabs.map((tab) => [tab.id, tab]))
  const ordered: Tab[] = []
  for (const group of state.groupsByWorktree[worktreeId] ?? []) {
    for (const tabId of group.tabOrder) {
      const tab = byId.get(tabId)
      if (tab) {
        ordered.push(tab)
        byId.delete(tabId)
      }
    }
  }
  return [...ordered, ...byId.values()]
}

function adoptableView(
  state: AppState,
  tab: Tab,
  worktreeLabel: string
): WorkbenchAdoptableTab | null {
  const label = workbenchTabLabel(state, tab)
  if (label === null) {
    return null
  }
  const terminalTab = findTerminalTabRow(state, tab)
  if (terminalTab) {
    return {
      tabId: tab.id,
      label,
      worktreeLabel,
      kind: 'terminal',
      agentState: workbenchTerminalAgentState(state, terminalTab),
      isImage: false
    }
  }
  const file = state.openFiles.find((candidate) => candidate.id === tab.entityId)
  return {
    tabId: tab.id,
    label,
    worktreeLabel,
    kind: 'editor',
    agentState: null,
    isImage: file ? isImageDropPath(file.filePath) : false
  }
}

/** Main-window tabs a workbench window may pull in; tabs already in any window are excluded. */
export function buildWorkbenchAdoptableTabs(state: AppState): WorkbenchAdoptableTab[] {
  if (isPairedWebClientWindow()) {
    return []
  }
  const adoptable: WorkbenchAdoptableTab[] = []
  for (const [worktreeId, tabs] of Object.entries(state.unifiedTabsByWorktree)) {
    let worktreeLabel: string | null = null
    for (const tab of orderedWorktreeTabs(state, worktreeId, tabs)) {
      if (adoptable.length >= WORKBENCH_MAX_ADOPTABLE_TABS) {
        return adoptable
      }
      if (
        state.detachedWindowIdByTabId[tab.id] !== undefined ||
        !isWorkbenchEligibleTab(state, tab)
      ) {
        continue
      }
      worktreeLabel ??= getNotificationWorkspaceLabels(state, worktreeId).worktreeLabel
      const view = adoptableView(state, tab, worktreeLabel)
      if (view) {
        adoptable.push(view)
      }
    }
  }
  return adoptable
}
