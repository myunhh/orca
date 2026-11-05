import type { StateCreator } from 'zustand'
import type { AppState } from '../types'

/** Which main-owned tabs a workbench window shows. View-only: tabs stay in their group's tabOrder; never saved. */
export type WorkbenchWindowOwnershipSlice = {
  detachedWindowIdByTabId: Readonly<Record<string, string>>
  assignTabsToWorkbenchWindow: (unifiedTabIds: readonly string[], windowId: string) => void
  returnTabToMainWindow: (unifiedTabId: string) => void
  /** Closing a workbench window folds its tabs back into the main window. */
  foldWorkbenchWindowTabsBack: (windowId: string) => void
  forgetDetachedTabs: (unifiedTabIds: readonly string[]) => void
}

const EMPTY_DETACHED: Readonly<Record<string, string>> = Object.freeze({})

function without(
  record: Readonly<Record<string, string>>,
  drop: (tabId: string, windowId: string) => boolean
): Readonly<Record<string, string>> {
  const entries = Object.entries(record)
  const kept = entries.filter(([tabId, windowId]) => !drop(tabId, windowId))
  if (kept.length === entries.length) {
    return record
  }
  return kept.length === 0 ? EMPTY_DETACHED : Object.fromEntries(kept)
}

export const createWorkbenchWindowOwnershipSlice: StateCreator<
  AppState,
  [],
  [],
  WorkbenchWindowOwnershipSlice
> = (set) => ({
  detachedWindowIdByTabId: EMPTY_DETACHED,
  assignTabsToWorkbenchWindow: (unifiedTabIds, windowId) => {
    if (unifiedTabIds.length === 0) {
      return
    }
    set((state) => {
      const next = { ...state.detachedWindowIdByTabId }
      for (const tabId of unifiedTabIds) {
        next[tabId] = windowId
      }
      return { detachedWindowIdByTabId: next }
    })
  },
  returnTabToMainWindow: (unifiedTabId) => {
    set((state) => ({
      detachedWindowIdByTabId: without(state.detachedWindowIdByTabId, (id) => id === unifiedTabId)
    }))
  },
  foldWorkbenchWindowTabsBack: (windowId) => {
    set((state) => ({
      detachedWindowIdByTabId: without(
        state.detachedWindowIdByTabId,
        (_tabId, owner) => owner === windowId
      )
    }))
  },
  forgetDetachedTabs: (unifiedTabIds) => {
    if (unifiedTabIds.length === 0) {
      return
    }
    const dropped = new Set(unifiedTabIds)
    set((state) => ({
      detachedWindowIdByTabId: without(state.detachedWindowIdByTabId, (id) => dropped.has(id))
    }))
  }
})
