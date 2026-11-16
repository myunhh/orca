import type {
  WorkbenchBrowserAction,
  WorkbenchBrowserFrame,
  WorkbenchBrowserViewport
} from '../../shared/workbench-window/workbench-window-types'
import {
  WORKBENCH_MAX_BROWSER_URL_CHARS,
  WORKBENCH_MAX_EDITOR_CONTENT_CHARS
} from '../../shared/workbench-window/workbench-window-types'
import { isId, isRecord, isText } from './workbench-payload-fields'

export function isWorkbenchBrowserView(value: unknown): boolean {
  return (
    isRecord(value) &&
    isId(value.workspaceId) &&
    (value.activePageId === null || isId(value.activePageId)) &&
    Array.isArray(value.pages) &&
    value.pages.every(
      (page) =>
        isRecord(page) &&
        isId(page.id) &&
        isText(page.title) &&
        isText(page.url, WORKBENCH_MAX_BROWSER_URL_CHARS) &&
        typeof page.loading === 'boolean' &&
        typeof page.canGoBack === 'boolean' &&
        typeof page.canGoForward === 'boolean'
    )
  )
}

export function isWorkbenchBrowserViewport(
  value: unknown
): value is WorkbenchBrowserViewport | null {
  if (value === null) {
    return true
  }
  if (!isRecord(value)) {
    return false
  }
  return (
    typeof value.width === 'number' &&
    Number.isFinite(value.width) &&
    value.width > 0 &&
    value.width <= 100_000 &&
    typeof value.height === 'number' &&
    Number.isFinite(value.height) &&
    value.height > 0 &&
    value.height <= 100_000
  )
}

export function admitWorkbenchBrowserFrame(value: unknown): WorkbenchBrowserFrame | null {
  if (
    !isRecord(value) ||
    !isId(value.pageId) ||
    !(value.bytes instanceof Uint8Array) ||
    value.bytes.byteLength > WORKBENCH_MAX_EDITOR_CONTENT_CHARS ||
    !isRecord(value.cssViewport)
  ) {
    return null
  }
  const { width, height } = value.cssViewport
  if (
    typeof width !== 'number' ||
    !Number.isFinite(width) ||
    width <= 0 ||
    typeof height !== 'number' ||
    !Number.isFinite(height) ||
    height <= 0
  ) {
    return null
  }
  return { pageId: value.pageId, bytes: value.bytes, cssViewport: { width, height } }
}

export function admitWorkbenchBrowserAction(value: unknown): WorkbenchBrowserAction | null {
  if (!isRecord(value)) {
    return null
  }
  switch (value.kind) {
    case 'navigate':
      return isText(value.url, 32 * 1024) ? { kind: 'navigate', url: value.url } : null
    case 'back':
    case 'forward':
    case 'reload':
    case 'reconnect':
      return { kind: value.kind }
    case 'key':
      return isText(value.key, 128) ? { kind: 'key', key: value.key } : null
    case 'text':
      return isText(value.text, 64 * 1024) ? { kind: 'text', text: value.text } : null
    case 'pointer':
    case 'wheel': {
      if (
        typeof value.x !== 'number' ||
        !Number.isFinite(value.x) ||
        value.x < 0 ||
        typeof value.y !== 'number' ||
        !Number.isFinite(value.y) ||
        value.y < 0
      ) {
        return null
      }
      if (value.kind === 'wheel') {
        return typeof value.deltaX === 'number' &&
          Number.isFinite(value.deltaX) &&
          typeof value.deltaY === 'number' &&
          Number.isFinite(value.deltaY)
          ? { kind: 'wheel', x: value.x, y: value.y, deltaX: value.deltaX, deltaY: value.deltaY }
          : null
      }
      return (value.phase === 'move' || value.phase === 'down' || value.phase === 'up') &&
        (value.button === 'left' || value.button === 'middle' || value.button === 'right')
        ? { kind: 'pointer', phase: value.phase, button: value.button, x: value.x, y: value.y }
        : null
    }
    default:
      return null
  }
}
