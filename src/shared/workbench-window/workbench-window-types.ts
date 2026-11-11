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
  /** Paired runtime that owns the terminal, or null for this desktop; the window has no worktree store. */
  runtimeEnvironmentId: string | null
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

/** A main-window tab a workbench window may pull in; the window has no store to list them itself. */
export type WorkbenchAdoptableTab = {
  tabId: string
  /** Groups the picker by workspace; labels alone repeat across repos. */
  worktreeId: string
  label: string
  worktreeLabel: string
  repoLabel: string | null
  kind: 'terminal' | 'editor'
  /** AgentDotState of the tab's live agent, if any. */
  agentState: string | null
  isImage: boolean
}

/** Published by the main renderer; a workbench window renders exactly these tabs. */
export type WorkbenchSnapshot = {
  tabs: WorkbenchTabView[]
  /** Assigned tabs whose view cannot be built yet; the window waits for them instead of closing. */
  pendingTabCount: number
  /** Main-window tabs not shown in any workbench window. */
  adoptableTabs: WorkbenchAdoptableTab[]
  /** More main-window tabs exist than `adoptableTabs` lists. */
  adoptableTabsTruncated: boolean
  generatedAt: number
}

/** `vertical` puts the new pane to the right, `horizontal` below, as in the main window. */
export type WorkbenchSplitDirection = 'vertical' | 'horizontal'

export type WorkbenchCommand =
  | { kind: 'newTerminal'; worktreeId: string }
  | { kind: 'adoptTab'; tabId: string }
  | { kind: 'returnTab'; tabId: string }
  | { kind: 'closeTab'; tabId: string }
  | { kind: 'revealInMain'; tabId: string }
  | { kind: 'readEditorFile'; tabId: string; requestId: string }
  | {
      kind: 'splitTerminalPane'
      tabId: string
      leafId: string
      direction: WorkbenchSplitDirection
    }

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

/** A command failure shown in the window that sent the command, not the main window behind it. */
export type WorkbenchNotice = {
  kind: 'error'
  message: string
  /** The adoptTab command this notice rejects, so the window stops waiting for that tab. */
  rejectedAdoptTabId?: string
}

/** A live workbench window; `ordinal` is fixed for its lifetime and shown in its title. */
export type WorkbenchWindowEntry = { windowId: string; ordinal: number }

export const WORKBENCH_MAX_TABS = 64
export const WORKBENCH_MAX_PANES_PER_TAB = 32
export const WORKBENCH_MAX_ADOPTABLE_TABS = 200
/** Base64 image or markdown text relayed between renderers; larger files stay in the main window. */
export const WORKBENCH_MAX_EDITOR_CONTENT_CHARS = 32 * 1024 * 1024
