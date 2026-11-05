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

/** Terminal to preselect as the target, e.g. the other half of a split view. */
export type TerminalContextSharePreferredTarget = { tabId: string; leafId: string | null }

type TerminalContextShareRequest = {
  id: number
  kind: TerminalContextShareKind
  source: TerminalContextShareSource
  preferredTarget?: TerminalContextSharePreferredTarget
}

// Own store, not activeModal: detached windows mount the host without the app's modal slice.
export const useTerminalContextShareRequest = create<{
  request: TerminalContextShareRequest | null
}>(() => ({ request: null }))

let nextRequestId = 1

function openRequest(
  kind: TerminalContextShareKind,
  source: TerminalContextShareSource,
  preferredTarget?: TerminalContextSharePreferredTarget
): void {
  useTerminalContextShareRequest.setState({
    request: { id: nextRequestId++, kind, source, preferredTarget }
  })
}

export function openShareTerminalContextDialog(args: {
  source: TerminalContextShareSource
  preferredTarget?: TerminalContextSharePreferredTarget
}): void {
  openRequest('share', args.source, args.preferredTarget)
}

export function openLinkTerminalsDialog(args: {
  source: TerminalContextShareSource
  preferredTarget?: TerminalContextSharePreferredTarget
}): void {
  openRequest('link', args.source, args.preferredTarget)
}

export function openTerminalContextShareDialog(
  kind: TerminalContextShareKind,
  source: TerminalContextShareSource,
  preferredTarget?: TerminalContextSharePreferredTarget
): void {
  openRequest(kind, source, preferredTarget)
}

export function closeTerminalContextShareDialog(): void {
  useTerminalContextShareRequest.setState({ request: null })
}
