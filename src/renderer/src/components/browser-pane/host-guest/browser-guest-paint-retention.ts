import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../../../store'
import type { AppState } from '@/store/types'
import {
  isBrowserPageMobileDriven,
  onBrowserDriverChange,
  useBrowserMobileDriverForAny
} from '../../../runtime/browser/ownership/browser-mobile-driver-state'
import { useBrowserRemoteViewerForAny } from '../../../runtime/browser/ownership/browser-remote-viewer-state'
import {
  isBrowserPageRemotelyViewed,
  onBrowserRemoteViewerChange
} from '../../../runtime/browser/ownership/browser-remote-viewer-store'
import {
  isBrowserAutomationVisible,
  onBrowserAutomationVisibilityChange,
  useBrowserAutomationVisibilityForAny
} from './browser-automation-visibility'

// Every ancestor must avoid display:none for retained guests; a pane cannot override hidden parents to keep mobile/agent/paired screencasts producing frames.

type BrowserTabPageIdSource = {
  id: string
  activePageId?: string | null
  pageIds?: readonly string[] | null
}

// Why: a stable identity keeps the disabled branch from re-running downstream shallow compares.
const NO_BROWSER_PAGE_IDS: readonly string[] = []

export function collectBrowserPageIds(
  tabs: readonly BrowserTabPageIdSource[] | null | undefined
): readonly string[] {
  // Why the early return: no browser tabs is the common case, and this runs on every store write.
  if (!tabs || tabs.length === 0) {
    return NO_BROWSER_PAGE_IDS
  }
  return tabs.flatMap((tab) =>
    tab.pageIds && tab.pageIds.length > 0 ? tab.pageIds : [tab.activePageId ?? tab.id]
  )
}
const NO_BROWSER_TABS_BY_WORKTREE: Record<string, BrowserTabPageIdSource[]> = {}

export function useWorktreeBrowserPageIds(worktreeId: string): readonly string[] {
  return useAppStore(
    useShallow((state) => collectBrowserPageIds(state.browserTabsByWorktree[worktreeId]))
  )
}

function isDetachedBrowserPage(state: AppState, browserPageIds: readonly string[]): boolean {
  if (browserPageIds.length === 0) {
    return false
  }
  for (const tabId in state.detachedWindowIdByTabId) {
    for (const worktreeId in state.unifiedTabsByWorktree) {
      const tab = state.unifiedTabsByWorktree[worktreeId].find((tab) => tab.id === tabId)
      if (
        tab?.contentType === 'browser' &&
        state.browserPagesByWorkspace[tab.entityId]?.some((page) =>
          browserPageIds.includes(page.id)
        )
      ) {
        return true
      }
    }
  }
  return false
}

export function useBrowserGuestPaintRetention(browserPageIds: readonly string[]): boolean {
  const hasAutomationVisibleBrowser = useBrowserAutomationVisibilityForAny(browserPageIds)
  const hasMobileDrivenBrowser = useBrowserMobileDriverForAny(browserPageIds)
  const hasRemotelyViewedBrowser = useBrowserRemoteViewerForAny(browserPageIds)
  const detached = useAppStore((state) => isDetachedBrowserPage(state, browserPageIds))
  return (
    detached || hasAutomationVisibleBrowser || hasMobileDrivenBrowser || hasRemotelyViewedBrowser
  )
}

// Centralize all paint-retention terms so new signals cannot silently miss a container gate.
export function browserPageNeedsPaintRetention(browserPageId: string): boolean {
  return (
    isDetachedBrowserPage(useAppStore.getState(), [browserPageId]) ||
    isBrowserAutomationVisible(browserPageId) ||
    isBrowserPageMobileDriven(browserPageId) ||
    isBrowserPageRemotelyViewed(browserPageId)
  )
}

/** Fires whenever any retention term flips, for callers that cache a retention decision. */
export function onBrowserGuestPaintRetentionChange(listener: () => void): () => void {
  const removeListeners = [
    onBrowserAutomationVisibilityChange(listener),
    onBrowserDriverChange(listener),
    onBrowserRemoteViewerChange(listener),
    useAppStore.subscribe((state, previous) => {
      if (
        state.detachedWindowIdByTabId !== previous.detachedWindowIdByTabId ||
        state.browserPagesByWorkspace !== previous.browserPagesByWorkspace
      ) {
        listener()
      }
    })
  ]
  return () => {
    for (const removeListener of removeListeners) {
      removeListener()
    }
  }
}

// Scan only for hidden callers. Include automation bootstrap: mobile driving starts after guest registration, so driver-only gating would deadlock a cold phone screencast.
export function useAnyBrowserGuestNeedsPaint(enabled: boolean): boolean {
  const browserTabsByWorktree = useAppStore((state) =>
    enabled ? state.browserTabsByWorktree : NO_BROWSER_TABS_BY_WORKTREE
  )
  const browserPageIds = useMemo(
    () =>
      enabled
        ? Object.values(browserTabsByWorktree).flatMap((tabs) => collectBrowserPageIds(tabs))
        : NO_BROWSER_PAGE_IDS,
    [browserTabsByWorktree, enabled]
  )
  return useBrowserGuestPaintRetention(browserPageIds)
}
