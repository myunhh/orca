import { ContextMenuSeparator } from '@/components/ui/context-menu'
import { useAppStore } from '@/store'
import { TerminalContextShareMenuItems } from './TerminalContextShareMenuItems'
import { openTerminalContextShareDialog } from './terminal-context-share-request'
import { terminalContextShareSourceForPane } from './terminal-context-share-source'

/** Tab-strip entry point: shares the tab's active pane. Hidden for tabs without a terminal layout. */
export function TabTerminalContextShareMenuItems({
  tabId,
  worktreeId
}: {
  tabId: string
  worktreeId: string
}): React.JSX.Element | null {
  const hasTerminalPane = useAppStore((state) =>
    Boolean(state.terminalLayoutsByTabId[tabId]?.activeLeafId)
  )
  if (!hasTerminalPane) {
    return null
  }
  return (
    <>
      <ContextMenuSeparator />
      <TerminalContextShareMenuItems
        menuKind="context"
        onOpen={(kind) => {
          const source = terminalContextShareSourceForPane(useAppStore.getState(), {
            worktreeId,
            tabId
          })
          if (source) {
            openTerminalContextShareDialog(kind, source)
          }
        }}
      />
    </>
  )
}
