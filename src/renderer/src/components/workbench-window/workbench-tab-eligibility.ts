import type { AppState } from '@/store/types'
import type { OpenFile } from '@/store/slices/editor/types/open-file'
import type { Tab } from '../../../../shared/tab-types'
import { isPairedWebClientWindow } from '@/app-shell/chrome/desktop-window-chrome'
import { isImageDropPath } from '../../../../shared/image-path-paste'
import { translate } from '@/i18n/i18n'

type EligibilityState = Pick<
  AppState,
  'unifiedTabsByWorktree' | 'openFiles' | 'browserPagesByWorkspace' | 'browserTabsByWorktree'
>

/** Markdown and images render read-only in a workbench window; other editors stay in the main window. */
export function isWorkbenchViewableFile(file: OpenFile): boolean {
  if (file.mode === 'markdown-preview') {
    return true
  }
  return file.mode === 'edit' && (file.language === 'markdown' || isImageDropPath(file.filePath))
}

export function findUnifiedTab(
  state: Pick<AppState, 'unifiedTabsByWorktree'>,
  unifiedTabId: string
): Tab | null {
  for (const tabs of Object.values(state.unifiedTabsByWorktree)) {
    const tab = tabs.find((candidate) => candidate.id === unifiedTabId)
    if (tab) {
      return tab
    }
  }
  return null
}

function browserTabContainsDocumentPages(
  state: Pick<AppState, 'browserPagesByWorkspace' | 'browserTabsByWorktree'>,
  tab: Tab
): boolean {
  const browser = state.browserTabsByWorktree[tab.worktreeId]?.find(
    (browser) => browser.id === tab.entityId
  )
  return Boolean(
    browser?.docLocation ||
    state.browserPagesByWorkspace[tab.entityId]?.some((page) => page.docLocation)
  )
}

export function workbenchTabMoveRestriction(
  state: Pick<
    AppState,
    'unifiedTabsByWorktree' | 'browserPagesByWorkspace' | 'browserTabsByWorktree'
  >,
  tabId: string
): string | null {
  const tab = findUnifiedTab(state, tabId)
  if (tab?.contentType !== 'browser') {
    return null
  }
  if (browserTabContainsDocumentPages(state, tab)) {
    return translate(
      'workbench.browser.documentStaysInMain',
      'Document previews stay in the main window. Open Markdown or images as editor tabs to move them.'
    )
  }
  return null
}

/** Desktop browser guests, terminals and viewable files retain their main-window owners. */
export function isWorkbenchEligibleTab(
  state: Pick<AppState, 'openFiles' | 'browserPagesByWorkspace' | 'browserTabsByWorktree'>,
  tab: Tab
): boolean {
  if (tab.contentType === 'browser') {
    return !browserTabContainsDocumentPages(state, tab)
  }
  if (tab.contentType === 'terminal') {
    return true
  }
  if (tab.contentType !== 'editor') {
    return false
  }
  const file = state.openFiles.find((candidate) => candidate.id === tab.entityId)
  return file ? isWorkbenchViewableFile(file) : false
}

/** Paired web clients cannot open native windows. */
export function canShowTabInWorkbenchWindow(
  state: EligibilityState,
  unifiedTabId: string
): boolean {
  if (isPairedWebClientWindow() || !window.api.workbenchWindows) {
    return false
  }
  const tab = findUnifiedTab(state, unifiedTabId)
  return tab ? isWorkbenchEligibleTab(state, tab) : false
}
