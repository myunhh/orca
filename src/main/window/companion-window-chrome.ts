import { app, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { Store } from '../persistence/loading-store/store'
import { stepUIZoomLevel, type UIZoomDirection } from '../../shared/ui-zoom-level'
import { nativeZoomCommandMatchesKeybindings } from '../../shared/window-shortcut-policy'
import {
  keybindingMatchesAction,
  type KeybindingActionId,
  type KeybindingInput,
  type KeybindingOverrides
} from '../../shared/keybindings'

export function stepCompanionWindowZoom(window: BrowserWindow, direction: UIZoomDirection): void {
  const webContents = window.webContents
  webContents.setZoomLevel(stepUIZoomLevel(webContents.getZoomLevel(), direction))
}

const ZOOM_SHORTCUTS: readonly [KeybindingActionId, UIZoomDirection][] = [
  ['zoom.in', 'in'],
  ['zoom.out', 'out'],
  ['zoom.reset', 'reset']
]

function resolveZoomShortcut(
  input: KeybindingInput,
  keybindings: KeybindingOverrides | undefined
): UIZoomDirection | null {
  // This runs per keydown; inspect only zoom shortcuts.
  for (const [actionId, direction] of ZOOM_SHORTCUTS) {
    if (
      keybindingMatchesAction(actionId, input, process.platform, keybindings, { context: 'app' })
    ) {
      return direction
    }
  }
  return null
}

/** Companion windows have no renderer shortcut router; apply app zoom and handle zoom chords here. Returns a disposer. */
export function installCompanionWindowZoom(
  window: BrowserWindow,
  store: Store | null,
  getKeybindings: (() => KeybindingOverrides | undefined) | undefined
): () => void {
  // Apply persisted app zoom or the window always opens at 100%.
  window.webContents.on('dom-ready', () => {
    if (!window.isDestroyed()) {
      window.webContents.setZoomLevel(store?.getUI().uiZoomLevel ?? 0)
    }
  })
  // Compare against last app zoom, not live window zoom, so local changes persist until app-wide zoom actually changes.
  let lastFollowedZoomLevel = store?.getUI().uiZoomLevel ?? 0
  const unsubscribeUIChanged = store?.onUIChanged((ui) => {
    const level = ui.uiZoomLevel ?? 0
    if (level === lastFollowedZoomLevel) {
      return
    }
    lastFollowedZoomLevel = level
    if (!window.isDestroyed()) {
      window.webContents.setZoomLevel(level)
    }
  })

  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') {
      return
    }
    const direction = resolveZoomShortcut(input, getKeybindings?.())
    if (direction) {
      event.preventDefault()
      stepCompanionWindowZoom(window, direction)
    }
  })

  window.webContents.on('zoom-changed', (event, direction) => {
    // Ctrl/Cmd+wheel arrives outside keyboard input routing.
    if (
      (direction === 'in' || direction === 'out') &&
      nativeZoomCommandMatchesKeybindings(direction, process.platform, getKeybindings?.(), {
        context: 'app'
      })
    ) {
      event.preventDefault()
      stepCompanionWindowZoom(window, direction)
    }
  })
  return () => unsubscribeUIChanged?.()
}

/** Match main-window loading: dev server entry versus packaged emitted HTML. */
export function loadCompanionRendererEntry(
  window: BrowserWindow,
  entry: string,
  query?: Record<string, string>
): void {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    const search = query ? `?${new URLSearchParams(query).toString()}` : ''
    void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/${entry}${search}`)
  } else if (query) {
    void window.loadFile(join(__dirname, `../renderer/${entry}`), { query })
  } else {
    void window.loadFile(join(__dirname, `../renderer/${entry}`))
  }
}
