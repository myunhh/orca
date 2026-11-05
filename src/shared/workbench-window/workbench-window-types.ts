import type { DashboardCardTerminalInput } from '../dashboard-snapshot'
import type { TerminalPaneLayoutNode } from '../workspace-layout/terminal-tab-types'

/** One live pane of a detached terminal tab; ptyId is null until the main window spawns it. */
export type WorkbenchTerminalPane = {
  leafId: string
  ptyId: string | null
  paneKey: string | null
  title: string | null
  terminalInput: DashboardCardTerminalInput | null
}

export type WorkbenchTerminalTabView = {
  /** Null for a single-pane tab whose only pane is `panes[0]`. */
  root: TerminalPaneLayoutNode | null
  activeLeafId: string | null
  panes: WorkbenchTerminalPane[]
}

export type WorkbenchEditorTabView = {
  fileId: string
  filePath: string
  relativePath: string
  language: string
  isImage: boolean
  runtimeEnvironmentId: string | null
}

export type WorkbenchTabView = {
  /** Unified tab id owned by the main window. */
  tabId: string
  worktreeId: string
  worktreeLabel: string
  label: string
  color: string | null
  kind: 'terminal' | 'editor'
  /** AgentDotState of the tab's live agent, if any. */
  agentState: string | null
  terminal: WorkbenchTerminalTabView | null
  editor: WorkbenchEditorTabView | null
}

/** Published by the main renderer; a workbench window renders exactly these tabs. */
export type WorkbenchSnapshot = {
  tabs: WorkbenchTabView[]
  generatedAt: number
}

export type WorkbenchCommand =
  | { kind: 'newTerminal'; worktreeId: string }
  | { kind: 'returnTab'; tabId: string }
  | { kind: 'closeTab'; tabId: string }
  | { kind: 'revealInMain'; tabId: string }
  | { kind: 'readEditorFile'; tabId: string; requestId: string }

/** A command relayed to the main renderer, stamped by main with the sender's window. */
export type WorkbenchRelayedCommand = { windowId: string; command: WorkbenchCommand }

export type WorkbenchEditorContent =
  | {
      requestId: string
      tabId: string
      status: 'ok'
      content: string
      isBinary: boolean
      mimeType: string | null
    }
  | { requestId: string; tabId: string; status: 'error'; message: string }

export const WORKBENCH_MAX_TABS = 64
export const WORKBENCH_MAX_PANES_PER_TAB = 32
/** Base64 image or markdown text relayed between renderers; larger files stay in the main window. */
export const WORKBENCH_MAX_EDITOR_CONTENT_CHARS = 32 * 1024 * 1024
