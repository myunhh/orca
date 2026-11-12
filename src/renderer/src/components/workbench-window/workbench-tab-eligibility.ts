import type { AppState } from '@/store/types'
import type { OpenFile } from '@/store/slices/editor/types/open-file'
import type { Tab } from '../../../../shared/tab-types'
import { isPairedWebClientWindow } from '@/app-shell/chrome/desktop-window-chrome'
import { isImageDropPath } from '../../../../shared/image-path-paste'

type EligibilityState = Pick<AppState, 'unifiedTabsByWorktree' | 'openFiles'>

/** Markdown and images render read-only in a workbench window; other editors stay in the main window. */
export function isWorkbenchViewableFile(file: OpenFile): boolean {
  if (file.mode === 'markdown-preview') {
    return true
  }
  return file.mode === 'edit' && (file.language === 'markdown' || isImageDropPath(file.filePath))
}

export function findUnifiedTab(state: EligibilityState, unifiedTabId: string): Tab | null {
  for (const tabs of Object.values(state.unifiedTabsByWorktree)) {
    const tab = tabs.find((candidate) => candidate.id === unifiedTabId)
    if (tab) {
      return tab
    }
  }
  return null
}

/** Only terminals and viewable files can show in a workbench window. */
export function isWorkbenchEligibleTab(state: Pick<AppState, 'openFiles'>, tab: Tab): boolean {
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
