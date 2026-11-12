import { mainI18n, translateMain } from '../i18n/main-i18n'
import { app, BrowserWindow, nativeTheme, type WebContents, type Event } from 'electron'
import { join } from 'node:path'
import type { Store } from '../persistence/loading-store/store'
import { isBackgroundLaunch, showWindowWithoutStealingFocus } from './foreground-activation-policy'
import { rectHasVisibleAreaOnAnyDisplay } from './window-bounds-validation'
import { sendToTrustedUIRenderer } from '../ipc/ui'
import { installPrivilegedWindowNavigationPolicy } from './privileged-window-navigation'
import type { UIZoomDirection } from '../../shared/ui-zoom-level'
import type { KeybindingOverrides } from '../../shared/keybindings'
import {
  installCompanionWindowZoom,
  loadCompanionRendererEntry,
  stepCompanionWindowZoom
} from './companion-window-chrome'
import { wslHostsWindowArguments } from '../wsl/host-lifecycle/wsl-host-gate'
import { isMacAppPasteInput } from './mac-app-paste-input'

const MIN_WIDTH = 480
const MIN_HEIGHT = 360
const DEFAULT_WIDTH = 960
const DEFAULT_HEIGHT = 720
const DASHBOARD_POPOUT_PARTITION = 'orca-dashboard-popout'

// Reuse the companion window across Pop Out requests.
let dashboardPopoutWindow: BrowserWindow | null = null

/** Live popout for snapshot relaying, or null. */
export function getDashboardPopoutWindow(): BrowserWindow | null {
  return dashboardPopoutWindow &&
    !dashboardPopoutWindow.isDestroyed() &&
    !dashboardPopoutWindow.webContents.isDestroyed()
    ? dashboardPopoutWindow
    : null
}

export function isDashboardPopoutRenderer(sender: WebContents): boolean {
  return getDashboardPopoutWindow()?.webContents === sender
}

/** Zoom the focused popout; return false so menu actions can fall back to the main window. */
export function zoomDashboardPopoutIfFocused(direction: UIZoomDirection): boolean {
  const popout = getDashboardPopoutWindow()
  if (!popout || !popout.isFocused()) {
    return false
  }
  stepCompanionWindowZoom(popout, direction)
  return true
}

// In-process listeners (the dashboard relay clears its cached snapshot on close).
const popoutOpenListeners = new Set<(open: boolean) => void>()

/** Subscribe to pop-out open/close transitions in the main process. */
export function onDashboardPopoutOpenChanged(listener: (open: boolean) => void): () => void {
  popoutOpenListeners.add(listener)
  return () => popoutOpenListeners.delete(listener)
}

// The main renderer publishes snapshots only while open; notify its exact trusted window before local listeners.
function broadcastPopoutOpenChanged(open: boolean): void {
  sendToTrustedUIRenderer('dashboard:popoutOpenChanged', open)
  for (const listener of popoutOpenListeners) {
    listener(open)
  }
}

function resolveRestoredBounds(store: Store | null): {
  x: number
  y: number
  width: number
  height: number
} | null {
  const raw = store?.getUI().dashboardPopoutBounds ?? null
  if (
    raw &&
    raw.width >= MIN_WIDTH &&
    raw.height >= MIN_HEIGHT &&
    rectHasVisibleAreaOnAnyDisplay(raw, MIN_WIDTH / 2, MIN_HEIGHT / 2)
  ) {
    return raw
  }
  if (raw) {
    console.warn('[dashboard-popout] Discarding off-screen/near-min popout bounds:', raw)
  }
  return null
}

/** Reuse a native-framed companion window with the main preload and its own popout.html renderer. */
export function createOrFocusDashboardPopout(
  store: Store | null,
  options: { getKeybindings?: () => KeybindingOverrides | undefined } = {}
): BrowserWindow {
  if (dashboardPopoutWindow && !dashboardPopoutWindow.isDestroyed()) {
    if (dashboardPopoutWindow.webContents.isCrashed()) {
      dashboardPopoutWindow.webContents.reload()
    }
    if (dashboardPopoutWindow.isMinimized()) {
      dashboardPopoutWindow.restore()
    }
    if (!isBackgroundLaunch()) {
      dashboardPopoutWindow.focus()
    }
    return dashboardPopoutWindow
  }

  const savedBounds = resolveRestoredBounds(store)

  // Serve-only: this window lists saved WSL hosts and their Connect, as the main window does.
  const wslArguments = wslHostsWindowArguments()
  const window = new BrowserWindow({
    width: savedBounds?.width ?? DEFAULT_WIDTH,
    height: savedBounds?.height ?? DEFAULT_HEIGHT,
    ...(savedBounds ? { x: savedBounds.x, y: savedBounds.y } : {}),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: translateMain('native.dialog.dashboardTitle', 'Orca Agent Dashboard'),
    show: false,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#ffffff',
    // Use native movable/closable chrome on every platform; the popout renders no custom titlebar.
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      // Chromium shares zoom by origin; isolate the session to keep popout zoom local.
      partition: DASHBOARD_POPOUT_PARTITION,
      // No webviews run here; disable embedding and omit host identity so client-placed pages stay mirrors.
      webviewTag: false,
      ...(wslArguments.length > 0 ? { additionalArguments: wslArguments } : {})
    }
  })
  installPrivilegedWindowNavigationPolicy(window.webContents)
  // Isolated sessions do not inherit the main session's deny-by-default permission policy.
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false)
  )
  window.webContents.session.setPermissionCheckHandler(() => false)
  dashboardPopoutWindow = window
  broadcastPopoutOpenChanged(true)

  const disposeZoom = installCompanionWindowZoom(window, store, options.getKeybindings)
  window.webContents.on('before-input-event', (event, input) => {
    if (isMacAppPasteInput(input)) {
      // Kitty-mode xterm encodes Cmd+V as CSI u and consumes it, so the Edit menu accelerator never fires.
      event.preventDefault()
      window.webContents.send('ui:appMenuPaste')
    }
  })

  window.once('ready-to-show', () => {
    showWindowWithoutStealingFocus(window)
  })

  // Freeze/debounce remembered bounds during teardown so resize events cannot replace them with minimum size.
  let boundsTimer: ReturnType<typeof setTimeout> | null = null
  let windowClosing = false
  const saveBounds = (): void => {
    if (boundsTimer) {
      clearTimeout(boundsTimer)
    }
    boundsTimer = setTimeout(() => {
      boundsTimer = null
      if (windowClosing || window.isDestroyed() || window.isMinimized() || window.isFullScreen()) {
        return
      }
      const bounds = window.getBounds()
      if (bounds.width < MIN_WIDTH || bounds.height < MIN_HEIGHT) {
        return
      }
      store?.updateUI({ dashboardPopoutBounds: bounds })
    }, 500)
  }
  window.on('resize', saveBounds)
  window.on('move', saveBounds)

  const freezeBounds = (event?: Event): void => {
    if (event?.defaultPrevented) {
      return
    }
    windowClosing = true
    if (boundsTimer) {
      clearTimeout(boundsTimer)
      boundsTimer = null
    }
  }
  window.on('close', freezeBounds)
  app.on('before-quit', freezeBounds)

  window.on('page-title-updated', (event) => {
    event.preventDefault()
  })
  const updateTitle = (): void => {
    if (!window.isDestroyed()) {
      window.setTitle(translateMain('native.dialog.dashboardTitle', 'Orca Agent Dashboard'))
    }
  }
  mainI18n.on('languageChanged', updateTitle)

  window.on('closed', () => {
    mainI18n.off('languageChanged', updateTitle)
    app.removeListener('before-quit', freezeBounds)
    disposeZoom()
    if (dashboardPopoutWindow === window) {
      dashboardPopoutWindow = null
    }
    broadcastPopoutOpenChanged(false)
  })

  loadCompanionRendererEntry(window, 'popout.html')
  return window
}

/** Close with the owning main window so the dashboard cannot become orphaned. */
export function closeDashboardPopout(): void {
  if (dashboardPopoutWindow && !dashboardPopoutWindow.isDestroyed()) {
    dashboardPopoutWindow.close()
  }
  dashboardPopoutWindow = null
}
