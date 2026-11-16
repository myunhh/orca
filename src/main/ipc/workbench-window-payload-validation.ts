import type {
  WorkbenchAdoptableTab,
  WorkbenchCommand,
  WorkbenchEditorContent,
  WorkbenchNotice,
  WorkbenchSnapshot,
  WorkbenchTabView,
  WorkbenchTerminalPane
} from '../../shared/workbench-window/workbench-window-types'
import {
  WORKBENCH_MAX_ADOPTABLE_TABS,
  WORKBENCH_MAX_EDITOR_CONTENT_CHARS,
  WORKBENCH_MAX_PANES_PER_TAB,
  WORKBENCH_MAX_TABS
} from '../../shared/workbench-window/workbench-window-types'
import type { TerminalPaneLayoutNode } from '../../shared/workspace-layout/terminal-tab-types'
import { isDashboardTerminalInput } from './dashboard-payload-validation'
import { isId, isNullableText, isRecord, isText } from './workbench-payload-fields'
import {
  admitWorkbenchBrowserAction,
  isWorkbenchBrowserView
} from './workbench-browser-payload-validation'

const MAX_LAYOUT_DEPTH = 16

function isLayoutNode(value: unknown, depth: number): value is TerminalPaneLayoutNode {
  if (!isRecord(value) || depth > MAX_LAYOUT_DEPTH) {
    return false
  }
  if (value.type === 'leaf') {
    return isId(value.leafId)
  }
  return (
    value.type === 'split' &&
    (value.direction === 'vertical' || value.direction === 'horizontal') &&
    (value.ratio === undefined ||
      (typeof value.ratio === 'number' && Number.isFinite(value.ratio))) &&
    isLayoutNode(value.first, depth + 1) &&
    isLayoutNode(value.second, depth + 1)
  )
}

function isPane(value: unknown): value is WorkbenchTerminalPane {
  return (
    isRecord(value) &&
    isId(value.leafId) &&
    (value.ptyId === null || isId(value.ptyId)) &&
    (value.paneKey === null || isId(value.paneKey)) &&
    isNullableText(value.title) &&
    (value.terminalInput === null || isDashboardTerminalInput(value.terminalInput))
  )
}

function isTerminalView(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.root === null || isLayoutNode(value.root, 0)) &&
    (value.activeLeafId === null || isId(value.activeLeafId)) &&
    (value.runtimeEnvironmentId === null || isId(value.runtimeEnvironmentId)) &&
    Array.isArray(value.panes) &&
    value.panes.length <= WORKBENCH_MAX_PANES_PER_TAB &&
    value.panes.every(isPane)
  )
}

function isEditorView(value: unknown): boolean {
  return (
    isRecord(value) &&
    isId(value.fileId) &&
    isText(value.filePath) &&
    isText(value.relativePath) &&
    isText(value.language, 128) &&
    typeof value.isImage === 'boolean' &&
    (value.runtimeEnvironmentId === null || isId(value.runtimeEnvironmentId))
  )
}

function isTabView(value: unknown): value is WorkbenchTabView {
  if (!isRecord(value) || !isId(value.tabId) || !isId(value.worktreeId)) {
    return false
  }
  if (!isText(value.worktreeLabel) || !isText(value.label) || !isNullableText(value.color, 64)) {
    return false
  }
  if (!isNullableText(value.agentState, 64)) {
    return false
  }
  if (value.kind === 'terminal') {
    return isTerminalView(value.terminal) && value.editor === null
  }
  if (value.kind === 'browser') {
    return isWorkbenchBrowserView(value.browser) && value.editor === null && value.terminal === null
  }
  return value.kind === 'editor' && isEditorView(value.editor) && value.terminal === null
}

function isAdoptableTab(value: unknown): value is WorkbenchAdoptableTab {
  return (
    isRecord(value) &&
    isId(value.tabId) &&
    isId(value.worktreeId) &&
    isText(value.label) &&
    isText(value.worktreeLabel) &&
    isNullableText(value.repoLabel) &&
    (value.kind === 'terminal' || value.kind === 'editor' || value.kind === 'browser') &&
    isNullableText(value.agentState, 64) &&
    typeof value.isImage === 'boolean'
  )
}

export function admitWorkbenchSnapshot(value: unknown): WorkbenchSnapshot | null {
  if (!isRecord(value) || typeof value.generatedAt !== 'number' || !Array.isArray(value.tabs)) {
    return null
  }
  if (value.tabs.length > WORKBENCH_MAX_TABS || !value.tabs.every(isTabView)) {
    return null
  }
  const adoptableTabs = value.adoptableTabs
  if (
    !Array.isArray(adoptableTabs) ||
    adoptableTabs.length > WORKBENCH_MAX_ADOPTABLE_TABS ||
    !adoptableTabs.every(isAdoptableTab)
  ) {
    return null
  }
  const pendingTabCount = value.pendingTabCount
  if (
    typeof value.adoptableTabsTruncated !== 'boolean' ||
    typeof pendingTabCount !== 'number' ||
    !Number.isSafeInteger(pendingTabCount) ||
    pendingTabCount < 0
  ) {
    return null
  }
  return {
    tabs: value.tabs,
    pendingTabCount,
    adoptableTabs,
    adoptableTabsTruncated: value.adoptableTabsTruncated,
    generatedAt: value.generatedAt
  }
}

export function admitWorkbenchCommand(value: unknown): WorkbenchCommand | null {
  if (!isRecord(value)) {
    return null
  }
  switch (value.kind) {
    case 'newTerminal':
      return isId(value.worktreeId) ? { kind: 'newTerminal', worktreeId: value.worktreeId } : null
    case 'adoptTab':
    case 'returnTab':
    case 'closeTab':
    case 'revealInMain':
      return isId(value.tabId) ? { kind: value.kind, tabId: value.tabId } : null
    case 'readEditorFile':
      return isId(value.tabId) && isId(value.requestId)
        ? { kind: 'readEditorFile', tabId: value.tabId, requestId: value.requestId }
        : null
    case 'readEditorImage':
      return isId(value.tabId) && isId(value.requestId) && isText(value.rawSrc) && value.rawSrc
        ? {
            kind: 'readEditorImage',
            tabId: value.tabId,
            requestId: value.requestId,
            rawSrc: value.rawSrc
          }
        : null
    case 'selectBrowserPage':
      return isId(value.tabId) && isId(value.pageId)
        ? { kind: 'selectBrowserPage', tabId: value.tabId, pageId: value.pageId }
        : null
    case 'browserAction': {
      const action = admitWorkbenchBrowserAction(value.action)
      return isId(value.tabId) && isId(value.pageId) && action
        ? { kind: 'browserAction', tabId: value.tabId, pageId: value.pageId, action }
        : null
    }
    case 'splitTerminalPane':
      return isId(value.tabId) &&
        isId(value.leafId) &&
        (value.direction === 'vertical' || value.direction === 'horizontal')
        ? {
            kind: 'splitTerminalPane',
            tabId: value.tabId,
            leafId: value.leafId,
            direction: value.direction
          }
        : null
    default:
      return null
  }
}

export function admitWorkbenchEditorContent(value: unknown): WorkbenchEditorContent | null {
  if (!isRecord(value) || !isId(value.requestId) || !isId(value.tabId)) {
    return null
  }
  if (value.status === 'error') {
    return isText(value.message)
      ? { requestId: value.requestId, tabId: value.tabId, status: 'error', message: value.message }
      : null
  }
  if (
    value.status !== 'ok' ||
    !isText(value.content, WORKBENCH_MAX_EDITOR_CONTENT_CHARS) ||
    typeof value.isBinary !== 'boolean' ||
    !isNullableText(value.mimeType, 128)
  ) {
    return null
  }
  return {
    requestId: value.requestId,
    tabId: value.tabId,
    status: 'ok',
    content: value.content,
    isBinary: value.isBinary,
    mimeType: typeof value.mimeType === 'string' ? value.mimeType : null
  }
}

export function admitWorkbenchTabIds(value: unknown): string[] | null {
  if (!isRecord(value) || !Array.isArray(value.tabIds)) {
    return null
  }
  const tabIds = value.tabIds
  return tabIds.length > 0 && tabIds.length <= WORKBENCH_MAX_TABS && tabIds.every(isId)
    ? tabIds
    : null
}

export function admitWorkbenchNotice(value: unknown): WorkbenchNotice | null {
  if (!isRecord(value) || value.kind !== 'error' || !isText(value.message) || !value.message) {
    return null
  }
  const rejected = value.rejectedAdoptTabId
  const browserPageId = value.browserPageId
  if (
    (rejected !== undefined && !isId(rejected)) ||
    (browserPageId !== undefined && !isId(browserPageId))
  ) {
    return null
  }
  return {
    kind: 'error',
    message: value.message,
    ...(rejected === undefined ? {} : { rejectedAdoptTabId: rejected }),
    ...(browserPageId === undefined ? {} : { browserPageId })
  }
}
