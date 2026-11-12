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
import { resolveDashboardCardTerminalInput } from '@/components/dashboard/dashboard-card-terminal-input'
import { readDashboardClientHost } from '@/components/dashboard/dashboard-client-host'
import { findWorktreeById } from '@/store/github/refresh/worktree-refresh'
import { runtimeEnvironmentIdOrLocalUnlessTwin } from '@/lib/workspace/ownership/worktree-runtime-owner'
import { findUnifiedTab, isWorkbenchViewableFile } from '../workbench-tab-eligibility'
import {
  findTerminalTabRow,
  workbenchTerminalAgentState,
  workbenchTerminalTabLabel,
  workbenchWorkspaceLabels
} from '../workbench-tab-label'
import {
  buildWorkbenchAdoptableTabs,
  type WorkbenchAdoptableTabList
} from './build-workbench-adoptable-tabs'

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
  return {
    root,
    activeLeafId: layout?.activeLeafId ?? null,
    panes,
    runtimeEnvironmentId: runtimeEnvironmentIdOrLocalUnlessTwin(state, terminalTab.worktreeId)
  }
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
  const common = {
    tabId: tab.id,
    worktreeId: tab.worktreeId,
    worktreeLabel: workbenchWorkspaceLabels(state, tab.worktreeId).worktreeLabel,
    color: tab.color ?? null
  }
  if (tab.contentType === 'terminal') {
    const terminalTab = findTerminalTabRow(state, tab)
    if (!terminalTab) {
      return null
    }
    const worktreePath = findWorktreeById(state, tab.worktreeId)?.path ?? ''
    return {
      ...common,
      label: workbenchTerminalTabLabel(state, tab, terminalTab),
      color: tab.color ?? terminalTab.color ?? null,
      kind: 'terminal',
      agentState: workbenchTerminalAgentState(state, terminalTab),
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
    label: resolveUnifiedTabLabel(
      tab,
      state.settings?.tabAutoGenerateTitle === true,
      editor.relativePath
    ),
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
  /** Shared by every window, including ones whose tabs all left. */
  adoptable: WorkbenchAdoptableTabList
}

export function buildWorkbenchSnapshots(state: AppState, now: number): WorkbenchSnapshotBuild {
  const snapshotsByWindowId = new Map<string, WorkbenchSnapshot>()
  const staleTabIds: string[] = []
  const adoptable = buildWorkbenchAdoptableTabs(state)
  for (const [tabId, windowId] of Object.entries(state.detachedWindowIdByTabId)) {
    let snapshot = snapshotsByWindowId.get(windowId)
    if (!snapshot) {
      snapshot = {
        tabs: [],
        pendingTabCount: 0,
        adoptableTabs: adoptable.tabs,
        adoptableTabsTruncated: adoptable.truncated,
        generatedAt: now
      }
      snapshotsByWindowId.set(windowId, snapshot)
    }
    if (!findUnifiedTab(state, tabId)) {
      staleTabIds.push(tabId)
      continue
    }
    const view = buildTabView(state, tabId)
    // A tab mid-update (no terminal row yet) stays assigned and reappears on the next build.
    if (!view) {
      snapshot.pendingTabCount += 1
    } else if (snapshot.tabs.length < WORKBENCH_MAX_TABS) {
      snapshot.tabs.push(view)
    }
  }
  return { snapshotsByWindowId, staleTabIds, adoptable }
}
