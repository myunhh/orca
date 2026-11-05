import { toast } from 'sonner'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import type { WorkbenchRelayedCommand } from '../../../../../shared/workbench-window/workbench-window-types'
import { dispatchWorkspaceTabCommand } from '@/lib/workspace-tab-commands'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { requestBackgroundTerminalWorktreeMount } from '@/components/terminal/background-terminal-worktree-mount'
import { resolveOwnerOrLocal } from '@/lib/worktree-runtime-owner'
import { resolveWorktreeOperationRouteResult } from '@/lib/worktree-operation-route'
import { isWebClientLocation } from '@/lib/web-client-location'
import { parseWorkspaceKey } from '../../../../../shared/workspace-scope'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../../shared/constants'
import { translate } from '@/i18n/i18n'
import { findUnifiedTab } from '../workbench-tab-eligibility'
import { assignTabsToWorkbenchWindow } from '../workbench-tab-move'
import { readWorkbenchEditorContent } from './workbench-editor-content-read'

const REMOTE_TERMINAL_ADOPT_TIMEOUT_MS = 20_000

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

/** A host-created terminal lands in a later layout frame; adopt the first new one into the window. */
function adoptNextRemoteTerminal(worktreeId: string, windowId: string, before: Set<string>): void {
  let settled = false
  const finish = (): void => {
    settled = true
    unsubscribe()
    clearTimeout(timer)
  }
  const unsubscribe = useAppStore.subscribe((state, previous) => {
    if (settled || state.unifiedTabsByWorktree === previous.unifiedTabsByWorktree) {
      return
    }
    const created = [...terminalUnifiedTabIds(state, worktreeId)].find((id) => !before.has(id))
    if (created) {
      finish()
      assignTabsToWorkbenchWindow([created], windowId)
    }
  })
  const timer = setTimeout(finish, REMOTE_TERMINAL_ADOPT_TIMEOUT_MS)
}

async function createTerminalForWindow(worktreeId: string, windowId: string): Promise<void> {
  const state = useAppStore.getState()
  const route = newTerminalRoute(state, worktreeId)
  const groupId = state.activeGroupIdByWorktree[worktreeId]
  if (route.kind === 'unresolved') {
    throw new Error(
      translate(
        'components.workbench.window.bridge.workbench.command.handler.workspaceNotReady',
        'This workspace is not ready for a new terminal yet.'
      )
    )
  }
  if (route.kind === 'runtime') {
    // Host terminals are created through the workspace's own "+" flow, which needs it shown.
    if (state.activeWorktreeId !== worktreeId && !activateAndRevealWorkspace(worktreeId)) {
      return
    }
    const latest = useAppStore.getState()
    const targetGroupId = latest.activeGroupIdByWorktree[worktreeId]
    if (!targetGroupId) {
      return
    }
    adoptNextRemoteTerminal(worktreeId, windowId, terminalUnifiedTabIds(latest, worktreeId))
    await latest.openNewTerminalTabInActiveWorkspace(targetGroupId)
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
      toast.error(error instanceof Error ? error.message : String(error))
    })
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
    case 'readEditorFile':
      void readWorkbenchEditorContent(state, command.tabId, command.requestId).then((content) =>
        window.api.workbenchWindows?.publishEditorContent(windowId, content)
      )
  }
}
