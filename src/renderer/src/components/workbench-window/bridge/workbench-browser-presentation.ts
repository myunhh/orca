import { useAppStore } from '@/store'
import { webviewRegistry } from '@/components/browser-pane/host-guest/webview-registry'
import { getBrowserPageRuntimeEnvironmentId } from '@/components/browser-pane/describe-page/browser-page-url-display'
import { isClientHostedBrowserPageHandle } from '@/store/slices/browser/hosts/browser-host-state'
import { runtimeEnvironmentIdOrLocalUnlessTwin } from '@/lib/workspace/ownership/worktree-runtime-owner'
import type { WorkbenchWindowsApi } from '../../../../../preload/api/workbench-windows-api'
import type { WorkbenchBrowserViewport } from '../../../../../shared/workbench-window/workbench-window-types'
import type { BrowserScreencastFrameMetadata } from '../../../../../shared/browser/screencast/browser-screencast-protocol'
import { resolveRemoteBrowserCssViewport } from '@/components/browser-pane/stream-remote/remote-browser-page-input-model'
import { workbenchTabMoveRestriction } from '../workbench-tab-eligibility'

const visiblePages = new Map<string, { windowId: string; viewport: WorkbenchBrowserViewport }>()
const reconnectByPageId = new Map<string, () => void>()
const localReconnectByPageId = new Map<string, () => void>()
const remoteNotices = new Map<string, string>()
const detachedPages = new Set<string>()

export function registerWorkbenchBrowserReconnect(
  pageId: string,
  reconnect: () => void
): () => void {
  reconnectByPageId.set(pageId, reconnect)
  return () => {
    if (reconnectByPageId.get(pageId) === reconnect) {
      reconnectByPageId.delete(pageId)
      remoteNotices.delete(pageId)
    }
  }
}

export function reconnectWorkbenchBrowser(pageId: string): void {
  const reconnect = localReconnectByPageId.get(pageId) ?? reconnectByPageId.get(pageId)
  if (!reconnect) {
    throw new Error('This browser page is still connecting.')
  }
  reconnect()
}

export function reportWorkbenchBrowserNotice(pageId: string, message: string | null): void {
  if (message) {
    remoteNotices.set(pageId, message)
  } else {
    remoteNotices.delete(pageId)
  }
  const presentation = visiblePages.get(pageId)
  if (presentation && message) {
    void window.api.workbenchWindows?.publishNotice(presentation.windowId, {
      kind: 'error',
      message,
      browserPageId: pageId
    })
  }
}

export function forwardWorkbenchBrowserFrame(
  pageId: string,
  bytes: Uint8Array,
  metadata: BrowserScreencastFrameMetadata,
  cssViewport: WorkbenchBrowserViewport | null,
  requestedViewport: WorkbenchBrowserViewport | null
): boolean {
  if (!detachedPages.has(pageId)) {
    return false
  }
  const presentation = visiblePages.get(pageId)
  if (presentation) {
    void window.api.workbenchWindows?.publishBrowserFrame(presentation.windowId, {
      pageId,
      bytes,
      cssViewport: resolveRemoteBrowserCssViewport({
        cssViewportSize: cssViewport,
        requestedViewportSize: requestedViewport,
        frameMetadata: metadata,
        naturalSize: {
          width: metadata.imageWidth ?? metadata.deviceWidth ?? 1,
          height: metadata.imageHeight ?? metadata.deviceHeight ?? 1
        }
      })
    })
  }
  return true
}

export function startWorkbenchBrowserPresentationBridge(api: WorkbenchWindowsApi): () => void {
  const sizedViewports = new Map<HTMLElement, { width: string; height: string; flex: string }>()
  const localStreams = new Map<string, { windowId: string; sizeKey: string }>()
  let timer: ReturnType<typeof setTimeout> | undefined
  const sync = (): void => {
    clearTimeout(timer)
    timer = undefined
    const state = useAppStore.getState()
    detachedPages.clear()
    const localPages = new Set<string>()
    for (const tabId in state.detachedWindowIdByTabId) {
      for (const worktreeId in state.unifiedTabsByWorktree) {
        const tab = state.unifiedTabsByWorktree[worktreeId].find((tab) => tab.id === tabId)
        if (tab?.contentType !== 'browser') {
          continue
        }
        if (workbenchTabMoveRestriction(state, tabId)) {
          continue
        }
        for (const page of state.browserPagesByWorkspace[tab.entityId] ?? []) {
          detachedPages.add(page.id)
          const presentation = visiblePages.get(page.id)
          if (!presentation || presentation.windowId !== state.detachedWindowIdByTabId[tab.id]) {
            continue
          }
          const environmentId = getBrowserPageRuntimeEnvironmentId(
            page,
            runtimeEnvironmentIdOrLocalUnlessTwin(state, worktreeId)
          )
          const handle = state.remoteBrowserPageHandlesByPageId[page.id]
          const local =
            webviewRegistry.has(page.id) ||
            !environmentId ||
            (handle && isClientHostedBrowserPageHandle(handle))
          if (!local) {
            continue
          }
          localPages.add(page.id)
          const { windowId, viewport } = presentation
          const sizeKey = `${windowId}:${viewport.width}:${viewport.height}`
          const previous = localStreams.get(page.id)
          const reportFailure = (error: unknown): void =>
            reportWorkbenchBrowserNotice(
              page.id,
              error instanceof Error ? error.message : String(error)
            )
          if (previous?.sizeKey !== sizeKey) {
            if (previous && previous.windowId !== windowId) {
              void api.streamLocalBrowser(previous.windowId, page.id, null)
            }
            localStreams.set(page.id, { windowId, sizeKey })
            void api.streamLocalBrowser(windowId, page.id, viewport).catch(reportFailure)
          }
          localReconnectByPageId.set(page.id, () => {
            void api.streamLocalBrowser(windowId, page.id, viewport, true).catch(reportFailure)
          })
        }
      }
    }
    for (const [pageId, stream] of localStreams) {
      if (!localPages.has(pageId)) {
        void api.streamLocalBrowser(stream.windowId, pageId, null)
        localStreams.delete(pageId)
        localReconnectByPageId.delete(pageId)
      }
    }
    for (const pageId of visiblePages.keys()) {
      if (!detachedPages.has(pageId)) {
        visiblePages.delete(pageId)
      }
    }
    for (const element of document.querySelectorAll<HTMLElement>(
      '[data-workbench-browser-remote-page]'
    )) {
      const pageId = element.dataset.workbenchBrowserRemotePage
      const viewport = pageId ? visiblePages.get(pageId)?.viewport : null
      const previous = sizedViewports.get(element)
      if (!viewport && !previous) {
        continue
      }
      if (viewport && !previous) {
        sizedViewports.set(element, {
          width: element.style.width,
          height: element.style.height,
          flex: element.style.flex
        })
      }
      const width = viewport ? `${viewport.width}px` : (previous?.width ?? '')
      const height = viewport ? `${viewport.height}px` : (previous?.height ?? '')
      const flex = viewport ? 'none' : (previous?.flex ?? '')
      if (element.style.width !== width) {
        element.style.width = width
      }
      if (element.style.height !== height) {
        element.style.height = height
      }
      if (element.style.flex !== flex) {
        element.style.flex = flex
      }
      if (!viewport) {
        sizedViewports.delete(element)
      }
    }
    for (const element of sizedViewports.keys()) {
      if (!element.isConnected) {
        sizedViewports.delete(element)
      }
    }
  }
  const schedule = (): void => {
    timer ??= setTimeout(sync, 0)
  }
  const offViewport = api.onBrowserViewportChanged(({ windowId, pageId, viewport }) => {
    if (viewport) {
      visiblePages.set(pageId, { windowId, viewport })
    } else if (visiblePages.get(pageId)?.windowId === windowId) {
      visiblePages.delete(pageId)
    }
    sync()
    if (viewport) {
      reportWorkbenchBrowserNotice(pageId, remoteNotices.get(pageId) ?? null)
    }
  })
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, {
    attributes: true,
    childList: true,
    subtree: true,
    attributeFilter: ['style', 'class']
  })
  const offStore = useAppStore.subscribe(schedule)
  window.addEventListener('resize', schedule)
  return () => {
    offViewport()
    offStore()
    observer.disconnect()
    window.removeEventListener('resize', schedule)
    clearTimeout(timer)
    for (const [pageId, stream] of localStreams) {
      void api.streamLocalBrowser(stream.windowId, pageId, null)
    }
    localReconnectByPageId.clear()
    visiblePages.clear()
    detachedPages.clear()
    remoteNotices.clear()
    for (const [element, previous] of sizedViewports) {
      element.style.width = previous.width
      element.style.height = previous.height
      element.style.flex = previous.flex
    }
  }
}
