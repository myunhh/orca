import { create } from 'zustand'

/** Everything the dialogs need; any window that can call the runtime can open them. */
export type TerminalContextShareSource = {
  tabId: string
  leafId: string
  ptyId: string | null
  worktreeId: string
  title: string
  /** Orca terminal handle when the caller already knows it. */
  handle?: string
  /** Owning runtime environment (null = this desktop); absent derives it from the app store. */
  runtimeEnvironmentId?: string | null
}

export type TerminalContextShareKind = 'share' | 'link'

type TerminalContextShareRequest = {
  id: number
  kind: TerminalContextShareKind
  source: TerminalContextShareSource
}

// Own store, not activeModal: detached windows mount the host without the app's modal slice.
export const useTerminalContextShareRequest = create<{
  request: TerminalContextShareRequest | null
}>(() => ({ request: null }))

let nextRequestId = 1

function openRequest(kind: TerminalContextShareKind, source: TerminalContextShareSource): void {
  useTerminalContextShareRequest.setState({ request: { id: nextRequestId++, kind, source } })
}

export function openShareTerminalContextDialog(args: { source: TerminalContextShareSource }): void {
  openRequest('share', args.source)
}

export function openLinkTerminalsDialog(args: { source: TerminalContextShareSource }): void {
  openRequest('link', args.source)
}

export function openTerminalContextShareDialog(
  kind: TerminalContextShareKind,
  source: TerminalContextShareSource
): void {
  openRequest(kind, source)
}

export function closeTerminalContextShareDialog(): void {
  useTerminalContextShareRequest.setState({ request: null })
}
