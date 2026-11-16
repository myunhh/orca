import { useAppStore } from '@/store'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { toRuntimeWorktreeSelector } from '@/runtime/rpc/targets/runtime-worktree-selector'
import { webviewRegistry } from '@/components/browser-pane/host-guest/webview-registry'
import { resolveBrowserAddressBarSubmission } from '@/components/browser-pane/navigate/browser-address-bar-navigation'
import type { WorkbenchBrowserAction } from '../../../../../shared/workbench-window/workbench-window-types'
import type { BrowserTabShowResult } from '../../../../../shared/browser/runtime/runtime-browser-contracts'
import { redactKagiSessionToken } from '../../../../../shared/browser-url'
import { reconnectWorkbenchBrowser } from './workbench-browser-presentation'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'
import { workbenchTabMoveRestriction } from '../workbench-tab-eligibility'

const queues = new Map<string, Promise<void>>()
const queuedMoves = new Map<
  string,
  {
    action: WorkbenchBrowserAction
    promise: Promise<void>
  }
>()

export function runWorkbenchBrowserAction(
  windowId: string,
  tabId: string,
  pageId: string,
  action: WorkbenchBrowserAction
): Promise<void> {
  const move = action.kind === 'pointer' && action.phase === 'move'
  const queued = queuedMoves.get(pageId)
  if (move && queued) {
    queued.action = action
    return queued.promise
  }
  if (!move) {
    queuedMoves.delete(pageId)
  }
  const job = { action, promise: Promise.resolve() }
  const run = async (): Promise<void> => {
    if (queuedMoves.get(pageId) === job) {
      queuedMoves.delete(pageId)
    }
    const action = job.action
    const state = useAppStore.getState()
    const tab = Object.values(state.unifiedTabsByWorktree)
      .flat()
      .find((tab) => tab.id === tabId)
    if (state.detachedWindowIdByTabId[tabId] !== windowId || tab?.contentType !== 'browser') {
      return
    }
    const restriction = workbenchTabMoveRestriction(state, tabId)
    if (restriction) {
      throw new Error(restriction)
    }
    if (!state.browserPagesByWorkspace[tab.entityId]?.some((page) => page.id === pageId)) {
      return
    }
    if (action.kind === 'reconnect') {
      reconnectWorkbenchBrowser(pageId)
      return
    }
    const native = webviewRegistry.get(pageId)
    if (native && action.kind === 'navigate') {
      const submission = resolveBrowserAddressBarSubmission(action.url, {
        allowFileUrls: false,
        allowExtensionPages: true
      })
      if (submission.status === 'invalid') {
        throw new Error(submission.loadError.description)
      }
      state.setBrowserPageUrl(pageId, submission.url)
      return
    }
    if (
      native &&
      (action.kind === 'back' || action.kind === 'forward' || action.kind === 'reload')
    ) {
      if (action.kind === 'back' && native.canGoBack()) {
        native.goBack()
      } else if (action.kind === 'forward' && native.canGoForward()) {
        native.goForward()
      } else if (action.kind === 'reload') {
        native.reload()
      }
      return
    }
    const handle = state.remoteBrowserPageHandlesByPageId[pageId]
    let target: RuntimeClientTarget
    let params: { page: string; worktree?: string }
    if (native) {
      target = { kind: 'local' }
      params = { page: pageId }
    } else {
      if (!handle) {
        throw new Error('This browser page is still connecting.')
      }
      target = { kind: 'environment', environmentId: handle.environmentId }
      params = { worktree: toRuntimeWorktreeSelector(tab.worktreeId), page: handle.remotePageId }
    }
    const options = { timeoutMs: 15_000, suppressFeatureInteraction: true }
    switch (action.kind) {
      case 'navigate': {
        const submission = resolveBrowserAddressBarSubmission(action.url, { allowFileUrls: false })
        if (submission.status === 'invalid') {
          throw new Error(submission.loadError.description)
        }
        await callRuntimeRpc(
          target,
          'browser.goto',
          { ...params, url: submission.url },
          { ...options, timeoutMs: 30_000 }
        )
        break
      }
      case 'back':
      case 'forward':
      case 'reload':
        await callRuntimeRpc(target, `browser.${action.kind}`, params, options)
        break
      case 'key':
        await callRuntimeRpc(target, 'browser.keypress', { ...params, key: action.key }, options)
        break
      case 'text':
        await callRuntimeRpc(
          target,
          'browser.keyboardInsertText',
          { ...params, text: action.text },
          options
        )
        break
      case 'pointer':
        await callRuntimeRpc(
          target,
          'browser.mouseMove',
          { ...params, x: action.x, y: action.y },
          options
        )
        if (action.phase !== 'move') {
          await callRuntimeRpc(
            target,
            action.phase === 'down' ? 'browser.mouseDown' : 'browser.mouseUp',
            { ...params, button: action.button },
            options
          )
        }
        break
      case 'wheel':
        await callRuntimeRpc(
          target,
          'browser.mouseMove',
          { ...params, x: action.x, y: action.y },
          options
        )
        await callRuntimeRpc(
          target,
          'browser.mouseWheel',
          { ...params, dx: action.deltaX, dy: action.deltaY },
          options
        )
        break
    }
    if (!native && (action.kind !== 'pointer' || action.phase === 'up')) {
      const shown = await callRuntimeRpc<BrowserTabShowResult>(
        target,
        'browser.tabShow',
        params,
        options
      )
      if (useAppStore.getState().remoteBrowserPageHandlesByPageId[pageId] === handle) {
        state.setBrowserPageUrl(pageId, redactKagiSessionToken(shown.tab.url))
        state.updateBrowserPageState(pageId, {
          title: shown.tab.title,
          loading: false,
          loadError: shown.tab.loadError ?? null
        })
      }
    }
  }
  const next = (queues.get(pageId) ?? Promise.resolve()).catch(() => {}).then(run)
  queues.set(pageId, next)
  job.promise = next
  if (move) {
    queuedMoves.set(pageId, job)
  }
  void next
    .finally(() => {
      if (queues.get(pageId) === next) {
        queues.delete(pageId)
      }
    })
    .catch(() => {})
  return next
}
