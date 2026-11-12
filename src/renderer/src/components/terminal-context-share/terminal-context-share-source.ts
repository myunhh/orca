import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import { parseRemoteRuntimePtyId } from '../../../../shared/remote-runtime/remote-runtime-pty-id'
import { runtimeTargetForOwnerEnvironment } from '@/runtime/rpc/targets/runtime-client-target'
import { runtimeEnvironmentIdOrLocalUnlessTwin } from '@/lib/workspace/ownership/worktree-runtime-owner'
import { resolveTerminalHandleForPane } from '@/components/terminal-pane/clipboard/terminal-handle-copy'
import { getActivePanePtyId, getActiveTerminalNoteTarget } from '@/lib/agent-session/messaging/terminal/active-agent-note-target'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import type { TerminalContextShareSource } from './terminal-context-share-request'

type SourceState = Pick<
  AppState,
  'tabsByWorktree' | 'terminalLayoutsByTabId' | 'ptyIdsByTabId' | 'activeWorktreeId'
>

/** Builds a dialog source for a terminal tab pane from the main window's store. */
export function terminalContextShareSourceForPane(
  state: SourceState,
  args: { worktreeId: string; tabId: string; leafId?: string | null; ptyId?: string | null }
): TerminalContextShareSource | null {
  const tab = (state.tabsByWorktree[args.worktreeId] ?? []).find((entry) => entry.id === args.tabId)
  const layout = state.terminalLayoutsByTabId[args.tabId]
  const leafId = args.leafId ?? layout?.activeLeafId ?? null
  if (!tab || !leafId) {
    return null
  }
  // Null lets handle resolution go through the pane key instead of guessing another pane's PTY.
  const ptyId = args.ptyId ?? getActivePanePtyId(state, { tabId: args.tabId, leafId })
  return {
    tabId: args.tabId,
    leafId,
    ptyId,
    worktreeId: args.worktreeId,
    title: layout?.titlesByLeafId?.[leafId] || tab.customTitle || tab.title
  }
}

export function activeTerminalContextShareSource(): TerminalContextShareSource | null {
  const state = useAppStore.getState()
  const worktreeId = state.activeWorktreeId
  const target = worktreeId ? getActiveTerminalNoteTarget(state, worktreeId) : null
  return worktreeId && target
    ? terminalContextShareSourceForPane(state, { worktreeId, ...target })
    : null
}

export function terminalContextShareRuntimeTarget(
  source: TerminalContextShareSource
): RuntimeClientTarget {
  const remote = source.ptyId ? parseRemoteRuntimePtyId(source.ptyId) : null
  if (remote?.environmentId) {
    return { kind: 'environment', environmentId: remote.environmentId }
  }
  if (source.runtimeEnvironmentId !== undefined) {
    return runtimeTargetForOwnerEnvironment(source.runtimeEnvironmentId)
  }
  return runtimeTargetForOwnerEnvironment(
    runtimeEnvironmentIdOrLocalUnlessTwin(useAppStore.getState(), source.worktreeId)
  )
}

export async function resolveTerminalContextShareSourceHandle(
  source: TerminalContextShareSource
): Promise<string> {
  if (source.handle) {
    return source.handle
  }
  // Same resolution as Copy Terminal ID; paired PTY ids already carry the owner's handle.
  return resolveTerminalHandleForPane({
    tabId: source.tabId,
    leafId: source.leafId,
    ptyId: source.ptyId,
    callRuntime: window.api.runtime.call
  })
}
