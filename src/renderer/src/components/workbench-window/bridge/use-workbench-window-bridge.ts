import { useEffect } from 'react'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import type { WorkbenchSnapshot } from '../../../../../shared/workbench-window/workbench-window-types'
import type { WorkbenchWindowsApi } from '../../../../../preload/api/workbench-windows-api'
import { syncZoomCSSVar } from '@/app-shell/chrome/ui-zoom'
import { buildWorkbenchSnapshots } from './build-workbench-snapshot'
import { handleWorkbenchCommand } from './workbench-command-handler'
import { watchDetachedTabActivation } from './detached-tab-activation-guard'

// Agent-status bursts would otherwise rebuild every window's snapshot per event.
const PUBLISH_THROTTLE_MS = 250

function workbenchInputsChanged(state: AppState, previous: AppState): boolean {
  return (
    state.detachedWindowIdByTabId !== previous.detachedWindowIdByTabId ||
    state.unifiedTabsByWorktree !== previous.unifiedTabsByWorktree ||
    state.tabsByWorktree !== previous.tabsByWorktree ||
    state.terminalLayoutsByTabId !== previous.terminalLayoutsByTabId ||
    state.ptyIdsByTabId !== previous.ptyIdsByTabId ||
    state.openFiles !== previous.openFiles ||
    state.agentStatusByPaneKey !== previous.agentStatusByPaneKey ||
    state.agentStatusEpoch !== previous.agentStatusEpoch ||
    state.runtimePaneTitlesByTabId !== previous.runtimePaneTitlesByTabId ||
    state.paneForegroundAgentByPaneKey !== previous.paneForegroundAgentByPaneKey ||
    state.groupsByWorktree !== previous.groupsByWorktree ||
    state.activeWorktreeId !== previous.activeWorktreeId ||
    state.settings !== previous.settings
  )
}

function snapshotKey(snapshot: WorkbenchSnapshot): string {
  return JSON.stringify([
    snapshot.tabs,
    snapshot.pendingTabCount,
    snapshot.adoptableTabs,
    snapshot.adoptableTabsTruncated
  ])
}

/** Publish per-window snapshots and run window commands; keep subscriptions out of the effect body for cleanup clarity. */
function startWorkbenchWindowBridge(api: WorkbenchWindowsApi): () => void {
  const lastKeyByWindowId = new Map<string, string>()
  const requested = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastPublishAt = 0

  const publishNow = (): void => {
    timer = null
    lastPublishAt = Date.now()
    const state = useAppStore.getState()
    const { snapshotsByWindowId, staleTabIds, adoptable } = buildWorkbenchSnapshots(
      state,
      lastPublishAt
    )
    // Windows whose every tab left still need the empty view so they can close.
    for (const windowId of [...lastKeyByWindowId.keys(), ...requested]) {
      if (!snapshotsByWindowId.has(windowId)) {
        snapshotsByWindowId.set(windowId, {
          tabs: [],
          pendingTabCount: 0,
          adoptableTabs: adoptable.tabs,
          adoptableTabsTruncated: adoptable.truncated,
          generatedAt: lastPublishAt
        })
      }
    }
    for (const [windowId, snapshot] of snapshotsByWindowId) {
      const key = snapshotKey(snapshot)
      if (lastKeyByWindowId.get(windowId) === key && !requested.has(windowId)) {
        continue
      }
      void api.publishSnapshot(windowId, snapshot)
      if (snapshot.tabs.length === 0 && snapshot.pendingTabCount === 0) {
        lastKeyByWindowId.delete(windowId)
      } else {
        lastKeyByWindowId.set(windowId, key)
      }
    }
    requested.clear()
    if (staleTabIds.length > 0) {
      state.forgetDetachedTabs(staleTabIds)
    }
  }

  const schedule = (): void => {
    if (timer) {
      return
    }
    const wait = Math.max(0, PUBLISH_THROTTLE_MS - (Date.now() - lastPublishAt))
    timer = setTimeout(publishNow, wait)
  }

  const unsubscribeStore = useAppStore.subscribe((state, previous) => {
    // A workbench window zooms this window's origin too; keep fixed-DIP CSS compensation in step.
    if (state.uiZoomLevel !== previous.uiZoomLevel) {
      syncZoomCSSVar()
    }
    const hasWindows =
      lastKeyByWindowId.size > 0 || Object.keys(state.detachedWindowIdByTabId).length > 0
    if (hasWindows && workbenchInputsChanged(state, previous)) {
      schedule()
    }
  })
  const offRequested = api.onSnapshotRequested((windowId) => {
    requested.add(windowId)
    schedule()
  })
  const offCommand = api.onCommand(handleWorkbenchCommand)
  const offActivationGuard = watchDetachedTabActivation()
  const offClosed = api.onWindowClosed((windowId) => {
    lastKeyByWindowId.delete(windowId)
    useAppStore.getState().foldWorkbenchWindowTabsBack(windowId)
  })
  return () => {
    if (timer) {
      clearTimeout(timer)
    }
    unsubscribeStore()
    offRequested()
    offCommand()
    offActivationGuard()
    offClosed()
  }
}

/** Main renderer only: the single owner of every tab a workbench window shows. */
export function useWorkbenchWindowBridge(): void {
  useEffect(() => {
    const api = window.api.workbenchWindows
    if (!api) {
      return
    }
    // Windows from an earlier renderer lifetime show tabs this store no longer marks detached.
    void api.closeAll()
    return startWorkbenchWindowBridge(api)
  }, [])
}
