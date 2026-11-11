import { toast } from 'sonner'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import type { WorkbenchRelayedCommand } from '../../../../../shared/workbench-window/workbench-window-types'
import { WORKBENCH_MAX_TABS } from '../../../../../shared/workbench-window/workbench-window-types'
import { dispatchWorkspaceTabCommand } from '@/lib/workspace-tab-commands'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { requestBackgroundTerminalWorktreeMount } from '@/components/terminal/background-terminal-worktree-mount'
import { resolveOwnerOrLocal } from '@/lib/worktree-runtime-owner'
import { resolveWorktreeOperationRouteResult } from '@/lib/worktree-operation-route'
import { isWebClientLocation } from '@/lib/web-client-location'
import { parseWorkspaceKey } from '../../../../../shared/workspace-scope'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../../shared/constants'
import { translate } from '@/i18n/i18n'
import { canShowTabInWorkbenchWindow, findUnifiedTab } from '../workbench-tab-eligibility'
import { findTerminalTabRow } from '../workbench-tab-label'
import { assignTabsToWorkbenchWindow } from '../workbench-tab-move'
import { countWorkbenchWindowTabs } from '../workbench-window-summaries'
import { readWorkbenchEditorContent } from './workbench-editor-content-read'
import { routeRuntimeTerminalSplitRequest } from '@/hooks/ipc-events/terminal-ui-routing-ipc-bridge'

// The host's frame lands shortly after creation resolves; adopting later could take a user's own new tab.
const REMOTE_TERMINAL_ADOPT_GRACE_MS = 5_000

type NewTerminalRoute =
  | { kind: 'unresolved' }
  | { kind: 'runtime'; environmentId: string }
  | { kind: 'local' }

// Route by the workspace's owner; a workbench window always has a source workspace.
function newTerminalRoute(state: AppState, worktreeId: string): NewTerminalRoute {
  const scope = parseWorkspaceKey(worktreeId)
  if (worktreeId !== FLOATING_TERMINAL_WORKTREE_ID && scope?.type !== 'folder') {
    const result = resolveWorktreeOperationRouteResult(state, worktreeId)
    if (result.kind !== 'resolved') {
      return { kind: 'unresolved' }
    }
    const environmentId = result.route.runtimeEnvironmentId
    return environmentId ? { kind: 'runtime', environmentId } : { kind: 'local' }
  }
  const match = resolveOwnerOrLocal(state, { workspaceId: worktreeId })
  if (match.kind !== 'resolved') {
    return { kind: 'unresolved' }
  }
  return match.owner.endpoint.kind === 'environment'
    ? { kind: 'runtime', environmentId: match.owner.endpoint.environmentId }
    : { kind: 'local' }
}

function terminalUnifiedTabIds(state: AppState, worktreeId: string): Set<string> {
  return new Set(
    (state.unifiedTabsByWorktree[worktreeId] ?? [])
      .filter((tab) => tab.contentType === 'terminal')
      .map((tab) => tab.id)
  )
}

/** A host-created terminal lands in a later layout frame; adopt the first new one in the group into the window. */
function adoptNextRemoteTerminal(
  worktreeId: string,
  groupId: string,
  windowId: string
): { stopAfterGrace: () => void; stop: () => void } {
  const before = terminalUnifiedTabIds(useAppStore.getState(), worktreeId)
  let timer: ReturnType<typeof setTimeout> | null = null
  const stop = (): void => {
    unsubscribe()
    if (timer) {
      clearTimeout(timer)
    }
  }
  const unsubscribe = useAppStore.subscribe((state, previous) => {
    if (state.unifiedTabsByWorktree === previous.unifiedTabsByWorktree) {
      return
    }
    const created = (state.unifiedTabsByWorktree[worktreeId] ?? []).find(
      (tab) => tab.contentType === 'terminal' && tab.groupId === groupId && !before.has(tab.id)
    )
    if (created) {
      stop()
      assignTabsToWorkbenchWindow([created.id], windowId)
    }
  })
  return {
    stop,
    stopAfterGrace: () => {
      timer ??= setTimeout(stop, REMOTE_TERMINAL_ADOPT_GRACE_MS)
    }
  }
}

function workspaceNotReadyError(): Error {
  return new Error(
    translate(
      'components.workbench.window.bridge.workbench.command.handler.workspaceNotReady',
      'This workspace is not ready for a new terminal yet.'
    )
  )
}

// Snapshots drop views past the cap, so a tab added to a full window would vanish from both windows.
function isWindowFull(state: AppState, windowId: string): boolean {
  return countWorkbenchWindowTabs(state.detachedWindowIdByTabId, windowId) >= WORKBENCH_MAX_TABS
}

function windowFullMessage(): string {
  return translate(
    'components.workbench.window.bridge.workbench.command.handler.windowFull',
    'This window cannot hold more tabs.'
  )
}

async function createTerminalForWindow(worktreeId: string, windowId: string): Promise<void> {
  const state = useAppStore.getState()
  if (isWindowFull(state, windowId)) {
    throw new Error(windowFullMessage())
  }
  const route = newTerminalRoute(state, worktreeId)
  const groupId = state.activeGroupIdByWorktree[worktreeId]
  if (route.kind === 'unresolved') {
    throw workspaceNotReadyError()
  }
  if (route.kind === 'runtime') {
    // Host terminals are created through the workspace's own "+" flow, which needs it shown.
    if (state.activeWorktreeId !== worktreeId) {
      activateAndRevealWorkspace(worktreeId)
    }
    const latest = useAppStore.getState()
    const targetGroupId = latest.activeGroupIdByWorktree[worktreeId]
    // Activation can be deferred (a workspace still being created); the "+" flow would target another one.
    if (latest.activeWorktreeId !== worktreeId || !targetGroupId) {
      throw workspaceNotReadyError()
    }
    const adoption = adoptNextRemoteTerminal(worktreeId, targetGroupId, windowId)
    try {
      await latest.openNewTerminalTabInActiveWorkspace(targetGroupId)
    } catch (error) {
      adoption.stop()
      throw error
    }
    adoption.stopAfterGrace()
    return
  }
  if (isWebClientLocation()) {
    return
  }
  // Background creation: the main window keeps its selection and mounts only this pane so it spawns.
  const terminal = state.createTab(worktreeId, groupId, undefined, {
    activate: false,
    recordInteraction: false
  })
  requestBackgroundTerminalWorktreeMount({ worktreeId, tabIds: [terminal.id] })
  const unifiedTab = (useAppStore.getState().unifiedTabsByWorktree[worktreeId] ?? []).find(
    (tab) => tab.contentType === 'terminal' && tab.entityId === terminal.id
  )
  if (unifiedTab) {
    assignTabsToWorkbenchWindow([unifiedTab.id], windowId)
  }
}

function notifyWindow(windowId: string, message: string, rejectedAdoptTabId?: string): void {
  const api = window.api.workbenchWindows
  if (api) {
    void api.publishNotice(windowId, { kind: 'error', message, rejectedAdoptTabId })
  } else {
    toast.error(message)
  }
}

/** Pull a main-window tab into the window; the same successor selection as Move to New Window. */
function adoptTabIntoWindow(tabId: string, windowId: string): void {
  const state = useAppStore.getState()
  const tab = findUnifiedTab(state, tabId)
  if (
    !tab ||
    state.detachedWindowIdByTabId[tabId] !== undefined ||
    !canShowTabInWorkbenchWindow(state, tabId)
  ) {
    notifyWindow(
      windowId,
      translate(
        'components.workbench.window.bridge.workbench.command.handler.adoptUnavailable',
        'That tab is no longer available to add.'
      ),
      tabId
    )
    return
  }
  if (isWindowFull(state, windowId)) {
    notifyWindow(windowId, windowFullMessage(), tabId)
    return
  }
  const terminalTab = findTerminalTabRow(state, tab)
  // A terminal in a workspace the main window never showed has no PTY yet; mount just that pane.
  if (terminalTab && (state.ptyIdsByTabId?.[terminalTab.id] ?? []).length === 0) {
    requestBackgroundTerminalWorktreeMount({ worktreeId: tab.worktreeId, tabIds: [terminalTab.id] })
  }
  assignTabsToWorkbenchWindow([tabId], windowId)
}

function revealTabInMainWindow(tabId: string): void {
  const state = useAppStore.getState()
  const tab = findUnifiedTab(state, tabId)
  state.returnTabToMainWindow(tabId)
  if (!tab) {
    return
  }
  if (state.activeWorktreeId !== tab.worktreeId) {
    activateAndRevealWorkspace(tab.worktreeId)
  }
  useAppStore.getState().activateTab(tabId, { worktreeId: tab.worktreeId })
}

/** Commands are scoped to the sending window: a window may only act on tabs it shows. */
export function handleWorkbenchCommand({ windowId, command }: WorkbenchRelayedCommand): void {
  const state = useAppStore.getState()
  if (command.kind === 'newTerminal') {
    void createTerminalForWindow(command.worktreeId, windowId).catch((error: unknown) => {
      notifyWindow(windowId, error instanceof Error ? error.message : String(error))
    })
    return
  }
  if (command.kind === 'adoptTab') {
    adoptTabIntoWindow(command.tabId, windowId)
    return
  }
  if (state.detachedWindowIdByTabId[command.tabId] !== windowId) {
    return
  }
  switch (command.kind) {
    case 'returnTab':
      state.returnTabToMainWindow(command.tabId)
      return
    case 'revealInMain':
      revealTabInMainWindow(command.tabId)
      return
    case 'closeTab': {
      const tab = findUnifiedTab(state, command.tabId)
      if (tab) {
        dispatchWorkspaceTabCommand({
          type: 'close',
          target: { kind: 'tab', worktreeId: tab.worktreeId, tabId: tab.id }
        })
      }
      return
    }
    case 'splitTerminalPane': {
      const tab = findUnifiedTab(state, command.tabId)
      const terminalTab = tab ? findTerminalTabRow(state, tab) : null
      if (tab && terminalTab) {
        // Same path as `orca terminal split`: it mounts the pane in the background when needed.
        routeRuntimeTerminalSplitRequest({
          tabId: terminalTab.id,
          worktreeId: tab.worktreeId,
          paneRuntimeId: -1,
          sourceLeafId: command.leafId,
          direction: command.direction,
          telemetrySource: 'command'
        })
      }
      return
    }
    case 'readEditorFile':
      void readWorkbenchEditorContent(state, command.tabId, command.requestId).then((content) =>
        window.api.workbenchWindows?.publishEditorContent(windowId, content)
      )
  }
}
