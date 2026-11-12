import { useAppStore } from '@/store'
import type { TerminalPaneController } from './controller/use-terminal-pane-controller'
import {
  openTerminalContextShareDialog,
  type TerminalContextShareKind
} from '../terminal-context-share/terminal-context-share-request'
import { terminalContextShareSourceForPane } from '../terminal-context-share/terminal-context-share-source'

/** Opens Share Context / Link Terminals for the pane the terminal menu was opened on. */
export function openMenuPaneContextShare(
  kind: TerminalContextShareKind,
  controller: Pick<
    TerminalPaneController,
    'tabId' | 'worktreeId' | 'managerRef' | 'paneTransportsRef' | 'contextMenu'
  >
): void {
  const manager = controller.managerRef.current
  const menuPaneId = controller.contextMenu.menuPaneId
  const pane =
    (menuPaneId !== null
      ? manager?.getPanes().find((candidate) => candidate.id === menuPaneId)
      : null) ??
    manager?.getActivePane() ??
    null
  if (!pane) {
    return
  }
  const transport = controller.paneTransportsRef.current?.get(pane.id)
  const source = terminalContextShareSourceForPane(useAppStore.getState(), {
    worktreeId: controller.worktreeId,
    tabId: controller.tabId,
    leafId: pane.leafId,
    ptyId: transport?.getPtyId() ?? null
  })
  if (!source) {
    return
  }
  const runtimeEnvironmentId = transport?.getRuntimeEnvironmentId?.()
  openTerminalContextShareDialog(
    kind,
    runtimeEnvironmentId === undefined ? source : { ...source, runtimeEnvironmentId }
  )
}
