import { app, ipcMain } from 'electron'
import type { Store } from '../persistence/loading-store/store'
import type { KeybindingService } from '../keybindings/keybinding-service'
import type {
  WorkbenchSnapshot,
  WorkbenchWindowEntry
} from '../../shared/workbench-window/workbench-window-types'
import {
  closeAllWorkbenchWindows,
  createWorkbenchWindow,
  getWorkbenchWindow,
  getWorkbenchWindowIdForSender,
  listWorkbenchWindowEntries,
  onWorkbenchWindowClosed
} from '../window/workbench-windows'
import { safelyRevealWindow } from '../window/focus-existing-window'
import { isBackgroundLaunch } from '../window/foreground-activation-policy'
import { getTrustedUIRendererWindow, isTrustedUIRenderer, sendToTrustedUIRenderer } from './ui'
import {
  admitWorkbenchCommand,
  admitWorkbenchEditorContent,
  admitWorkbenchNotice,
  admitWorkbenchSnapshot,
  admitWorkbenchTabIds
} from './workbench-window-payload-validation'

const CHANNELS = [
  'workbench:open',
  'workbench:listWindows',
  'workbench:publishSnapshot',
  'workbench:requestSnapshot',
  'workbench:command',
  'workbench:publishEditorContent',
  'workbench:publishNotice',
  'workbench:closeAll'
] as const

let disposeClosedListener: (() => void) | null = null

function windowIdArg(value: unknown): string | null {
  const windowId =
    value && typeof value === 'object' && 'windowId' in value ? value.windowId : undefined
  return typeof windowId === 'string' && windowId.length > 0 ? windowId : null
}

function revealMainWindow(): void {
  const mainWindow = getTrustedUIRendererWindow()
  if (!mainWindow) {
    return
  }
  safelyRevealWindow(mainWindow)
  if (!isBackgroundLaunch()) {
    try {
      app.focus({ steal: true })
    } catch {
      // Best-effort; the per-window reveal above may still bring it forward.
    }
  }
}

/** Workbench windows are views: the trusted main renderer publishes and executes, the window requests. */
export function registerWorkbenchWindowHandlers(
  store: Store,
  keybindings?: KeybindingService
): void {
  for (const channel of CHANNELS) {
    ipcMain.removeHandler(channel)
  }
  // Replay on mount; dropped with its window.
  const lastSnapshotByWindowId = new Map<string, WorkbenchSnapshot>()

  disposeClosedListener?.()
  disposeClosedListener = onWorkbenchWindowClosed((windowId) => {
    lastSnapshotByWindowId.delete(windowId)
    sendToTrustedUIRenderer('workbench:windowClosed', { windowId })
  })

  ipcMain.handle('workbench:open', (event, args: unknown): { windowId: string } | null => {
    const tabIds = admitWorkbenchTabIds(args)
    if (!isTrustedUIRenderer(event.sender) || !tabIds) {
      return null
    }
    const { windowId } = createWorkbenchWindow(store, {
      getKeybindings: () => keybindings?.getOverrides()
    })
    return { windowId }
  })

  // Main's registry is the authority on which windows still exist; the renderer's map can lag a close.
  ipcMain.handle('workbench:listWindows', (event): WorkbenchWindowEntry[] =>
    isTrustedUIRenderer(event.sender) ? listWorkbenchWindowEntries() : []
  )

  ipcMain.handle('workbench:publishSnapshot', (event, args: unknown): void => {
    const windowId = windowIdArg(args)
    const window = windowId ? getWorkbenchWindow(windowId) : null
    if (!isTrustedUIRenderer(event.sender) || !windowId || !window) {
      return
    }
    const snapshot = admitWorkbenchSnapshot(
      args && typeof args === 'object' && 'snapshot' in args ? args.snapshot : null
    )
    if (!snapshot) {
      console.warn('[workbench] rejected malformed snapshot; window keeps its previous view')
      return
    }
    lastSnapshotByWindowId.set(windowId, snapshot)
    window.webContents.send('workbench:snapshot', snapshot)
  })

  ipcMain.handle('workbench:requestSnapshot', (event): void => {
    const windowId = getWorkbenchWindowIdForSender(event.sender)
    if (!windowId) {
      return
    }
    const cached = lastSnapshotByWindowId.get(windowId)
    if (cached) {
      event.sender.send('workbench:snapshot', cached)
    }
    sendToTrustedUIRenderer('workbench:snapshotRequested', { windowId })
  })

  ipcMain.handle('workbench:command', (event, args: unknown): void => {
    const windowId = getWorkbenchWindowIdForSender(event.sender)
    const command = admitWorkbenchCommand(args)
    if (!windowId || !command) {
      return
    }
    if (command.kind === 'revealInMain') {
      revealMainWindow()
    }
    sendToTrustedUIRenderer('workbench:command', { windowId, command })
  })

  ipcMain.handle('workbench:publishEditorContent', (event, args: unknown): void => {
    const windowId = windowIdArg(args)
    const window = windowId ? getWorkbenchWindow(windowId) : null
    if (!isTrustedUIRenderer(event.sender) || !window) {
      return
    }
    const content = admitWorkbenchEditorContent(
      args && typeof args === 'object' && 'content' in args ? args.content : null
    )
    if (content) {
      window.webContents.send('workbench:editorContent', content)
    }
  })

  ipcMain.handle('workbench:publishNotice', (event, args: unknown): void => {
    const windowId = windowIdArg(args)
    const window = windowId ? getWorkbenchWindow(windowId) : null
    if (!isTrustedUIRenderer(event.sender) || !window) {
      return
    }
    const notice = admitWorkbenchNotice(
      args && typeof args === 'object' && 'notice' in args ? args.notice : null
    )
    if (notice) {
      window.webContents.send('workbench:notice', notice)
    }
  })

  // A reloaded main renderer lost its detached-tab map; its windows would show stale views.
  ipcMain.handle('workbench:closeAll', (event): void => {
    if (isTrustedUIRenderer(event.sender)) {
      lastSnapshotByWindowId.clear()
      closeAllWorkbenchWindows()
    }
  })
}
