import type { AppState } from '@/store/types'
import type { Tab } from '../../../../../shared/tab-types'
import type {
  TerminalPaneLayoutNode,
  TerminalTab
} from '../../../../../shared/workspace-layout/terminal-tab-types'
import type {
  WorkbenchEditorTabView,
  WorkbenchSnapshot,
  WorkbenchTabView,
  WorkbenchTerminalPane
} from '../../../../../shared/workbench-window/workbench-window-types'
import {
  WORKBENCH_MAX_PANES_PER_TAB,
  WORKBENCH_MAX_TABS
} from '../../../../../shared/workbench-window/workbench-window-types'
import {
  isTerminalLeafId,
  makePaneKey
} from '../../../../../shared/workspace-layout/stable-pane-id'
import { resolveUnifiedTabLabel } from '../../../../../shared/tab-title-resolution'
import { isImageDropPath } from '../../../../../shared/image-path-paste'
import { getNotificationWorkspaceLabels } from '@/components/terminal-pane/terminal-notification-state'
import { resolveDashboardCardTerminalInput } from '@/components/dashboard/dashboard-card-terminal-input'
import { readDashboardClientHost } from '@/components/dashboard/dashboard-client-host'
import {
  resolveTerminalTabActivityStatus,
  terminalTabActivityToAgentDotState
} from '@/components/tab-bar/terminal-tab-activity-status'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { selectWorktreesByRepo } from '@/store/workspace-record-selectors'
import { findUnifiedTab, isWorkbenchViewableFile } from '../workbench-tab-eligibility'

const SINGLE_PANE_LEAF_ID = 'pane'

function collectLeafIds(node: TerminalPaneLayoutNode | null, into: string[]): string[] {
  if (!node || into.length >= WORKBENCH_MAX_PANES_PER_TAB) {
    return into
  }
  if (node.type === 'leaf') {
    into.push(node.leafId)
    return into
  }
  collectLeafIds(node.first, into)
  return collectLeafIds(node.second, into)
}

function buildTerminalPanes(
  state: AppState,
  terminalTab: TerminalTab,
  worktreePath: string
): WorkbenchTabView['terminal'] {
  const layout = state.terminalLayoutsByTabId?.[terminalTab.id]
  const livePtyIds = state.ptyIdsByTabId?.[terminalTab.id] ?? []
  // Layouts survive restarts; advertise only PTYs the live set still contains.
  const liveOrNull = (ptyId: string | null | undefined): string | null =>
    ptyId && livePtyIds.includes(ptyId) ? ptyId : null
  const root = layout?.root ?? null
  const leafIds = root ? collectLeafIds(root, []) : [layout?.activeLeafId ?? SINGLE_PANE_LEAF_ID]
  const clientHost = readDashboardClientHost()
  const panes = leafIds.map((leafId): WorkbenchTerminalPane => {
    const ptyId = liveOrNull(root ? layout?.ptyIdsByLeafId?.[leafId] : terminalTab.ptyId)
    const paneKey = isTerminalLeafId(leafId) ? makePaneKey(terminalTab.id, leafId) : null
    return {
      leafId,
      ptyId,
      paneKey,
      title: layout?.titlesByLeafId?.[leafId] ?? null,
      terminalInput: ptyId
        ? resolveDashboardCardTerminalInput(state, {
            ptyId,
            worktreeId: terminalTab.worktreeId,
            paneKey: paneKey ?? '',
            cwd: terminalTab.startupCwd ?? worktreePath,
            shellOverride: terminalTab.shellOverride,
            launchAgent: terminalTab.launchAgent,
            clientPlatform: clientHost.platform,
            userAgent: clientHost.userAgent,
            osRelease: clientHost.osRelease
          })
        : null
    }
  })
  return { root, activeLeafId: layout?.activeLeafId ?? null, panes }
}

function buildEditorView(state: AppState, tab: Tab): WorkbenchEditorTabView | null {
  const file = state.openFiles.find((candidate) => candidate.id === tab.entityId)
  if (!file || !isWorkbenchViewableFile(file)) {
    return null
  }
  return {
    fileId: file.id,
    filePath: file.filePath,
    relativePath: file.relativePath,
    language: file.language,
    isImage: isImageDropPath(file.filePath),
    runtimeEnvironmentId: file.runtimeEnvironmentId ?? null
  }
}

function buildTabView(state: AppState, unifiedTabId: string): WorkbenchTabView | null {
  const tab = findUnifiedTab(state, unifiedTabId)
  if (!tab) {
    return null
  }
  const generatedTitles = state.settings?.tabAutoGenerateTitle === true
  const common = {
    tabId: tab.id,
    worktreeId: tab.worktreeId,
    worktreeLabel: getNotificationWorkspaceLabels(state, tab.worktreeId).worktreeLabel,
    color: tab.color ?? null
  }
  if (tab.contentType === 'terminal') {
    const terminalTab = (state.tabsByWorktree[tab.worktreeId] ?? []).find(
      (candidate) => candidate.id === tab.entityId
    )
    if (!terminalTab) {
      return null
    }
    const worktreePath = findWorktreeById(selectWorktreesByRepo(state), tab.worktreeId)?.path ?? ''
    const activity = resolveTerminalTabActivityStatus({
      tab: terminalTab,
      agentStatusByPaneKey: state.agentStatusByPaneKey,
      agentStatusEpoch: state.agentStatusEpoch,
      runtimePaneTitlesByTabId: state.runtimePaneTitlesByTabId,
      ptyIdsByTabId: state.ptyIdsByTabId,
      terminalLayout: state.terminalLayoutsByTabId?.[terminalTab.id]
    })
    return {
      ...common,
      label: resolveUnifiedTabLabel(
        {
          ...tab,
          quickCommandLabel: tab.quickCommandLabel ?? terminalTab.quickCommandLabel,
          generatedLabel: tab.generatedLabel ?? terminalTab.generatedTitle
        },
        generatedTitles,
        terminalTab.customTitle ?? terminalTab.title
      ),
      color: tab.color ?? terminalTab.color ?? null,
      kind: 'terminal',
      agentState: terminalTabActivityToAgentDotState(activity),
      terminal: buildTerminalPanes(state, terminalTab, worktreePath),
      editor: null
    }
  }
  const editor = buildEditorView(state, tab)
  if (!editor) {
    return null
  }
  return {
    ...common,
    label: resolveUnifiedTabLabel(tab, generatedTitles, editor.relativePath),
    kind: 'editor',
    agentState: null,
    terminal: null,
    editor
  }
}

export type WorkbenchSnapshotBuild = {
  snapshotsByWindowId: Map<string, WorkbenchSnapshot>
  /** Detached ids whose tab closed; the caller forgets them. */
  staleTabIds: string[]
}

export function buildWorkbenchSnapshots(state: AppState, now: number): WorkbenchSnapshotBuild {
  const snapshotsByWindowId = new Map<string, WorkbenchSnapshot>()
  const staleTabIds: string[] = []
  for (const [tabId, windowId] of Object.entries(state.detachedWindowIdByTabId)) {
    let snapshot = snapshotsByWindowId.get(windowId)
    if (!snapshot) {
      snapshot = { tabs: [], generatedAt: now }
      snapshotsByWindowId.set(windowId, snapshot)
    }
    if (!findUnifiedTab(state, tabId)) {
      staleTabIds.push(tabId)
      continue
    }
    const view = buildTabView(state, tabId)
    // A tab mid-update (no terminal row yet) stays assigned and reappears on the next build.
    if (view && snapshot.tabs.length < WORKBENCH_MAX_TABS) {
      snapshot.tabs.push(view)
    }
  }
  return { snapshotsByWindowId, staleTabIds }
}
