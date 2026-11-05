import type {
  WorkbenchCommand,
  WorkbenchEditorContent,
  WorkbenchRelayedCommand,
  WorkbenchSnapshot
} from '../../shared/workbench-window/workbench-window-types'

export type WorkbenchWindowsApi = {
  /** Main window only: opens a view window for main-owned tabs. */
  open: (tabIds: string[]) => Promise<{ windowId: string } | null>
  publishSnapshot: (windowId: string, snapshot: WorkbenchSnapshot) => Promise<void>
  publishEditorContent: (windowId: string, content: WorkbenchEditorContent) => Promise<void>
  closeAll: () => Promise<void>
  onSnapshotRequested: (callback: (windowId: string) => void) => () => void
  onCommand: (callback: (relayed: WorkbenchRelayedCommand) => void) => () => void
  onWindowClosed: (callback: (windowId: string) => void) => () => void
  /** Workbench windows only. */
  requestSnapshot: () => Promise<void>
  sendCommand: (command: WorkbenchCommand) => Promise<void>
  onSnapshot: (callback: (snapshot: WorkbenchSnapshot) => void) => () => void
  onEditorContent: (callback: (content: WorkbenchEditorContent) => void) => () => void
}
