import type { AppState } from '@/store/types'
import type { Tab } from '../../../../shared/tab-types'
import type { TerminalTab } from '../../../../shared/workspace-layout/terminal-tab-types'
import { resolveUnifiedTabLabel } from '../../../../shared/tab-title-resolution'
import {
  resolveTerminalTabActivityStatus,
  terminalTabActivityToAgentDotState
} from '@/components/tab-bar/terminal-tab-activity-status'

type LabelState = Pick<AppState, 'tabsByWorktree' | 'openFiles' | 'settings'>

export function findTerminalTabRow(
  state: Pick<AppState, 'tabsByWorktree'>,
  tab: Tab
): TerminalTab | null {
  if (tab.contentType !== 'terminal') {
    return null
  }
  return (
    (state.tabsByWorktree[tab.worktreeId] ?? []).find(
      (candidate) => candidate.id === tab.entityId
    ) ?? null
  )
}

export function workbenchTerminalTabLabel(
  state: Pick<AppState, 'settings'>,
  tab: Tab,
  terminalTab: TerminalTab
): string {
  return resolveUnifiedTabLabel(
    {
      ...tab,
      quickCommandLabel: tab.quickCommandLabel ?? terminalTab.quickCommandLabel,
      generatedLabel: tab.generatedLabel ?? terminalTab.generatedTitle
    },
    state.settings?.tabAutoGenerateTitle === true,
    terminalTab.customTitle ?? terminalTab.title
  )
}

/** The AgentDotState of a terminal tab's live agent, if any. */
export function workbenchTerminalAgentState(
  state: AppState,
  terminalTab: TerminalTab
): string | null {
  const activity = resolveTerminalTabActivityStatus({
    tab: terminalTab,
    agentStatusByPaneKey: state.agentStatusByPaneKey,
    agentStatusEpoch: state.agentStatusEpoch,
    runtimePaneTitlesByTabId: state.runtimePaneTitlesByTabId,
    ptyIdsByTabId: state.ptyIdsByTabId,
    terminalLayout: state.terminalLayoutsByTabId?.[terminalTab.id]
  })
  return terminalTabActivityToAgentDotState(activity)
}

/** The label the main tab strip shows for a terminal or editor tab; null while its row is missing. */
export function workbenchTabLabel(state: LabelState, tab: Tab): string | null {
  const terminalTab = findTerminalTabRow(state, tab)
  if (terminalTab) {
    return workbenchTerminalTabLabel(state, tab, terminalTab)
  }
  if (tab.contentType === 'terminal') {
    return null
  }
  const file = state.openFiles.find((candidate) => candidate.id === tab.entityId)
  return file
    ? resolveUnifiedTabLabel(tab, state.settings?.tabAutoGenerateTitle === true, file.relativePath)
    : null
}
