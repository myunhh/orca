import { useMemo } from 'react'
import { SquareStack } from 'lucide-react'
import {
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger
} from '@/components/ui/context-menu'
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import {
  summarizeWorkbenchWindows,
  type WorkbenchWindowSummary
} from '../workbench-window/workbench-window-summaries'
import { moveTabsToExistingWorkbenchWindow } from '../workbench-window/workbench-tab-move'

const MENU_PARTS = {
  context: {
    Sub: ContextMenuSub,
    SubTrigger: ContextMenuSubTrigger,
    SubContent: ContextMenuSubContent,
    Item: ContextMenuItem
  },
  dropdown: {
    Sub: DropdownMenuSub,
    SubTrigger: DropdownMenuSubTrigger,
    SubContent: DropdownMenuSubContent,
    Item: DropdownMenuItem
  }
} as const

function windowLabel(summary: WorkbenchWindowSummary): string {
  const name = translate(
    'components.tab.bar.MoveTabToWorkbenchWindowSubmenu.windowName',
    'Window {{windowNumber}}',
    { windowNumber: summary.ordinal }
  )
  return summary.firstTabLabel ? `${name} — ${summary.firstTabLabel}` : name
}

function tabCountLabel(count: number): string {
  return count === 1
    ? translate('components.tab.bar.MoveTabToWorkbenchWindowSubmenu.oneTab', '1 tab')
    : translate('components.tab.bar.MoveTabToWorkbenchWindowSubmenu.tabCount', '{{count}} tabs', {
        count
      })
}

/** "Move to Window ▸" lists the open workbench windows; hidden while none is open. */
export function MoveTabToWorkbenchWindowSubmenu({
  unifiedTabId,
  menuKind
}: {
  unifiedTabId: string
  menuKind: 'dropdown' | 'context'
}): React.JSX.Element | null {
  const detachedWindowIdByTabId = useAppStore((state) => state.detachedWindowIdByTabId)
  const unifiedTabsByWorktree = useAppStore((state) => state.unifiedTabsByWorktree)
  const tabsByWorktree = useAppStore((state) => state.tabsByWorktree)
  const openFiles = useAppStore((state) => state.openFiles)
  const settings = useAppStore((state) => state.settings)
  const summaries = useMemo(
    () =>
      summarizeWorkbenchWindows({
        detachedWindowIdByTabId,
        unifiedTabsByWorktree,
        tabsByWorktree,
        openFiles,
        settings
      }).filter((summary) => detachedWindowIdByTabId[unifiedTabId] !== summary.windowId),
    [
      detachedWindowIdByTabId,
      unifiedTabsByWorktree,
      tabsByWorktree,
      openFiles,
      settings,
      unifiedTabId
    ]
  )
  if (summaries.length === 0) {
    return null
  }
  const { Sub, SubTrigger, SubContent, Item } = MENU_PARTS[menuKind]
  return (
    <Sub>
      <SubTrigger>
        <SquareStack className="size-3.5 shrink-0" />
        {translate('components.tab.bar.MoveTabToWorkbenchWindowSubmenu.moveTo', 'Move to Window')}
      </SubTrigger>
      <SubContent className="max-w-80">
        {summaries.map((summary) => (
          <Item
            key={summary.windowId}
            onSelect={() =>
              void moveTabsToExistingWorkbenchWindow([unifiedTabId], summary.windowId)
            }
          >
            <span className="min-w-0 truncate">{windowLabel(summary)}</span>
            <span className="ml-auto shrink-0 pl-3 text-2xs text-muted-foreground">
              {tabCountLabel(summary.tabCount)}
            </span>
          </Item>
        ))}
      </SubContent>
    </Sub>
  )
}
