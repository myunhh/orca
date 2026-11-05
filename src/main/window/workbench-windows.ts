import { translateMain } from '../i18n/main-i18n'
import { BrowserWindow, nativeTheme, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { Store } from '../persistence/loading-store/store'
import { showWindowWithoutStealingFocus } from './foreground-activation-policy'
import { installPrivilegedWindowNavigationPolicy } from './privileged-window-navigation'
import type { UIZoomDirection } from '../../shared/ui-zoom-level'
import type { KeybindingOverrides } from '../../shared/keybindings'
import type { WorkbenchWindowEntry } from '../../shared/workbench-window/workbench-window-types'
import { wslHostsWindowArguments } from '../wsl/host-lifecycle/wsl-host-gate'
import {
  installCompanionWindowZoom,
  loadCompanionRendererEntry,
  stepSharedAppZoom
} from './companion-window-chrome'

const MIN_WIDTH = 480
const MIN_HEIGHT = 320
const DEFAULT_WIDTH = 1100
const DEFAULT_HEIGHT = 760
const CASCADE_OFFSET = 28

const windowsById = new Map<string, BrowserWindow>()
// Authority is the sender's webContents, never the window's own query string.
const windowIdByContentsId = new Map<number, string>()
const ordinalByWindowId = new Map<string, number>()
const closedListeners = new Set<(windowId: string) => void>()
let appZoomStore: Store | null = null

function isLive(window: BrowserWindow | undefined): window is BrowserWindow {
  return Boolean(window && !window.isDestroyed() && !window.webContents.isDestroyed())
}

export function getWorkbenchWindow(windowId: string): BrowserWindow | null {
  const window = windowsById.get(windowId)
  return isLive(window) ? window : null
}

export function getWorkbenchWindowIdForSender(sender: WebContents): string | null {
  const windowId = windowIdByContentsId.get(sender.id)
  return windowId && getWorkbenchWindow(windowId)?.webContents === sender ? windowId : null
}

export function isWorkbenchWindowRenderer(sender: WebContents): boolean {
  return getWorkbenchWindowIdForSender(sender) !== null
}

export function isWorkbenchWindow(window: BrowserWindow | null | undefined): boolean {
  return Boolean(window && [...windowsById.values()].includes(window))
}

export function listWorkbenchWindows(): BrowserWindow[] {
  return [...windowsById.values()].filter(isLive)
}

export function listWorkbenchWindowEntries(): WorkbenchWindowEntry[] {
  return [...ordinalByWindowId]
    .filter(([windowId]) => getWorkbenchWindow(windowId) !== null)
    .map(([windowId, ordinal]) => ({ windowId, ordinal }))
}

// Smallest free number, so names stay short and never shift while a window is open.
function nextWindowOrdinal(): number {
  const used = new Set(ordinalByWindowId.values())
  let ordinal = 1
  while (used.has(ordinal)) {
    ordinal += 1
  }
  return ordinal
}

/** Subscribe to workbench window closes in the main process. */
export function onWorkbenchWindowClosed(listener: (windowId: string) => void): () => void {
  closedListeners.add(listener)
  return () => closedListeners.delete(listener)
}

/** Zoom the focused workbench (the app zoom it shares); false lets menu actions fall back to the main window. */
export function zoomWorkbenchWindowIfFocused(direction: UIZoomDirection): boolean {
  const focused = listWorkbenchWindows().find((window) => window.isFocused())
  if (!focused) {
    return false
  }
  stepSharedAppZoom(focused, direction, appZoomStore)
  return true
}

function cascadeBounds(): { x: number; y: number } | null {
  const anchor = BrowserWindow.getFocusedWindow() ?? listWorkbenchWindows().at(-1) ?? null
  if (!anchor || anchor.isDestroyed()) {
    return null
  }
  const bounds = anchor.getBounds()
  return { x: bounds.x + CASCADE_OFFSET, y: bounds.y + CASCADE_OFFSET }
}

function workbenchTitle(): string {
  return translateMain('native.dialog.workbenchTitle', 'Orca Workbench')
}

/** A native-framed view window: the main renderer keeps owning every tab, PTY and layout it shows. */
export function createWorkbenchWindow(
  store: Store | null,
  options: { getKeybindings?: () => KeybindingOverrides | undefined } = {}
): { windowId: string; window: BrowserWindow } {
  const windowId = randomUUID()
  const position = cascadeBounds()
  const wslArguments = wslHostsWindowArguments()
  const window = new BrowserWindow({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    ...position,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: workbenchTitle(),
    show: false,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      // Default session on purpose: orca-media previews are registered there, and its permission policy already denies.
      webviewTag: false,
      ...(wslArguments.length > 0 ? { additionalArguments: wslArguments } : {})
    }
  })
  installPrivilegedWindowNavigationPolicy(window.webContents)
  const contentsId = window.webContents.id
  const ordinal = nextWindowOrdinal()
  windowsById.set(windowId, window)
  windowIdByContentsId.set(contentsId, windowId)
  ordinalByWindowId.set(windowId, ordinal)

  appZoomStore = store
  const disposeZoom = installCompanionWindowZoom(
    window,
    store,
    options.getKeybindings,
    (direction) => stepSharedAppZoom(window, direction, store)
  )
  window.once('ready-to-show', () => {
    showWindowWithoutStealingFocus(window)
  })

  window.on('closed', () => {
    disposeZoom()
    windowsById.delete(windowId)
    windowIdByContentsId.delete(contentsId)
    ordinalByWindowId.delete(windowId)
    for (const listener of closedListeners) {
      listener(windowId)
    }
  })

  loadCompanionRendererEntry(window, 'workbench.html', { windowId, ordinal: String(ordinal) })
  return { windowId, window }
}

/** Close with the owning main window so workbench views cannot outlive their owner. */
export function closeAllWorkbenchWindows(): void {
  for (const window of listWorkbenchWindows()) {
    window.close()
  }
}
