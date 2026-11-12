import type { AppState } from '@/store/types'
import type { Tab } from '../../../../../shared/tab-types'
import type { WorkbenchAdoptableTab } from '../../../../../shared/workbench-window/workbench-window-types'
import { WORKBENCH_MAX_ADOPTABLE_TABS } from '../../../../../shared/workbench-window/workbench-window-types'
import { isImageDropPath } from '../../../../../shared/image-path-paste'
import { isPairedWebClientWindow } from '@/app-shell/chrome/desktop-window-chrome'
import { isWorkbenchEligibleTab } from '../workbench-tab-eligibility'
import {
  findTerminalTabRow,
  workbenchTabLabel,
  workbenchTerminalAgentState,
  workbenchWorkspaceLabels
} from '../workbench-tab-label'

export type WorkbenchAdoptableTabList = { tabs: WorkbenchAdoptableTab[]; truncated: boolean }

type WorkspaceLabels = ReturnType<typeof workbenchWorkspaceLabels>

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
  workspace: WorkspaceLabels
): WorkbenchAdoptableTab | null {
  const label = workbenchTabLabel(state, tab)
  if (label === null) {
    return null
  }
  const common = { tabId: tab.id, worktreeId: tab.worktreeId, label, ...workspace }
  const terminalTab = findTerminalTabRow(state, tab)
  if (terminalTab) {
    return {
      ...common,
      kind: 'terminal',
      agentState: workbenchTerminalAgentState(state, terminalTab),
      isImage: false
    }
  }
  const file = state.openFiles.find((candidate) => candidate.id === tab.entityId)
  return {
    ...common,
    kind: 'editor',
    agentState: null,
    isImage: file ? isImageDropPath(file.filePath) : false
  }
}

// The cap keeps what the user most likely wants: the main window's workspace, then ones already split out.
function prioritizedWorktreeIds(state: AppState): string[] {
  const detachedSources = new Set<string>()
  for (const [worktreeId, tabs] of Object.entries(state.unifiedTabsByWorktree)) {
    if (tabs.some((tab) => state.detachedWindowIdByTabId[tab.id] !== undefined)) {
      detachedSources.add(worktreeId)
    }
  }
  const rank = (worktreeId: string): number =>
    worktreeId === state.activeWorktreeId ? 0 : detachedSources.has(worktreeId) ? 1 : 2
  return Object.keys(state.unifiedTabsByWorktree)
    .map((worktreeId, index) => ({ worktreeId, index, rank: rank(worktreeId) }))
    .toSorted((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ worktreeId }) => worktreeId)
}

/** Main-window tabs a workbench window may pull in; tabs already in any window are excluded. */
export function buildWorkbenchAdoptableTabs(state: AppState): WorkbenchAdoptableTabList {
  const tabs: WorkbenchAdoptableTab[] = []
  if (isPairedWebClientWindow()) {
    return { tabs, truncated: false }
  }
  for (const worktreeId of prioritizedWorktreeIds(state)) {
    let workspace: WorkspaceLabels | null = null
    for (const tab of orderedWorktreeTabs(
      state,
      worktreeId,
      state.unifiedTabsByWorktree[worktreeId]
    )) {
      if (
        state.detachedWindowIdByTabId[tab.id] !== undefined ||
        !isWorkbenchEligibleTab(state, tab)
      ) {
        continue
      }
      if (tabs.length >= WORKBENCH_MAX_ADOPTABLE_TABS) {
        return { tabs, truncated: true }
      }
      workspace ??= workbenchWorkspaceLabels(state, worktreeId)
      const view = adoptableView(state, tab, workspace)
      if (view) {
        tabs.push(view)
      }
    }
  }
  return { tabs, truncated: false }
}
