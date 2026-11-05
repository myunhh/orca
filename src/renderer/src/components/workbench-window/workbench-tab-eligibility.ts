import type { AppState } from '@/store/types'
import type { OpenFile } from '@/store/slices/editor'
import type { Tab } from '../../../../shared/tab-types'
import { isPairedWebClientWindow } from '@/lib/desktop-window-chrome'
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

/** Paired web clients cannot open native windows; only terminals and viewable files can move. */
export function canShowTabInWorkbenchWindow(
  state: EligibilityState,
  unifiedTabId: string
): boolean {
  if (isPairedWebClientWindow() || !window.api.workbenchWindows) {
    return false
  }
  const tab = findUnifiedTab(state, unifiedTabId)
  if (!tab) {
    return false
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
