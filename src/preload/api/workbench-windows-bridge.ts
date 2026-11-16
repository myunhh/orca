import { ipcRenderer } from 'electron'
import type {
  WorkbenchBrowserViewport,
  WorkbenchBrowserFrame,
  WorkbenchCommand,
  WorkbenchEditorContent,
  WorkbenchNotice,
  WorkbenchRelayedCommand,
  WorkbenchSnapshot
} from '../../shared/workbench-window/workbench-window-types'
import type { WorkbenchWindowsApi } from './workbench-windows-api'

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

export const workbenchWindowsApi = {
  open: (tabIds: string[]) => ipcRenderer.invoke('workbench:open', { tabIds }),
  listWindows: () => ipcRenderer.invoke('workbench:listWindows'),
  publishSnapshot: (windowId: string, snapshot: WorkbenchSnapshot) =>
    ipcRenderer.invoke('workbench:publishSnapshot', { windowId, snapshot }),
  publishEditorContent: (windowId: string, content: WorkbenchEditorContent) =>
    ipcRenderer.invoke('workbench:publishEditorContent', { windowId, content }),
  publishNotice: (windowId: string, notice: WorkbenchNotice) =>
    ipcRenderer.invoke('workbench:publishNotice', { windowId, notice }),
  closeAll: () => ipcRenderer.invoke('workbench:closeAll'),
  setBrowserViewport: (pageId: string, viewport: WorkbenchBrowserViewport | null) =>
    ipcRenderer.invoke('workbench:setBrowserViewport', { pageId, viewport }),
  streamLocalBrowser: (
    windowId: string,
    pageId: string,
    viewport: WorkbenchBrowserViewport | null,
    restart?: boolean
  ) => ipcRenderer.invoke('workbench:streamLocalBrowser', { windowId, pageId, viewport, restart }),
  publishBrowserFrame: (windowId: string, frame: WorkbenchBrowserFrame) =>
    ipcRenderer.invoke('workbench:publishBrowserFrame', { windowId, frame }),
  onBrowserFrame: (callback: (frame: WorkbenchBrowserFrame) => void) =>
    subscribe('workbench:browserFrame', callback),
  onBrowserViewportChanged: (
    callback: Parameters<WorkbenchWindowsApi['onBrowserViewportChanged']>[0]
  ) => subscribe('workbench:browserViewportChanged', callback),
  onSnapshotRequested: (callback: (windowId: string) => void) =>
    subscribe<{ windowId: string }>('workbench:snapshotRequested', (payload) =>
      callback(payload.windowId)
    ),
  onCommand: (callback: (relayed: WorkbenchRelayedCommand) => void) =>
    subscribe('workbench:command', callback),
  onWindowClosed: (callback: (windowId: string) => void) =>
    subscribe<{ windowId: string }>('workbench:windowClosed', (payload) =>
      callback(payload.windowId)
    ),
  requestSnapshot: () => ipcRenderer.invoke('workbench:requestSnapshot'),
  sendCommand: (command: WorkbenchCommand) => ipcRenderer.invoke('workbench:command', command),
  onSnapshot: (callback: (snapshot: WorkbenchSnapshot) => void) =>
    subscribe('workbench:snapshot', callback),
  onEditorContent: (callback: (content: WorkbenchEditorContent) => void) =>
    subscribe('workbench:editorContent', callback),
  onNotice: (callback: (notice: WorkbenchNotice) => void) => subscribe('workbench:notice', callback)
} satisfies WorkbenchWindowsApi
