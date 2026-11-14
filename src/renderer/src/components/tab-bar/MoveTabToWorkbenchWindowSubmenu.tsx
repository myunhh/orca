import { useEffect, useMemo, useState } from 'react'
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
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'
import {
  WORKBENCH_MAX_TABS,
  type WorkbenchWindowEntry
} from '../../../../shared/workbench-window/workbench-window-types'
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

type OrderedSummary = WorkbenchWindowSummary & { ordinal: number | null }

// Same "Window N" as that window's title bar; the suffix only hints at its contents.
function windowLabel(summary: OrderedSummary, t: Translate): string {
  if (summary.ordinal === null) {
    return summary.firstTabLabel ?? ''
  }
  const name = t(
    'components.tab.bar.MoveTabToWorkbenchWindowSubmenu.windowName',
    'Window {{windowNumber}}',
    { windowNumber: summary.ordinal }
  )
  return summary.firstTabLabel ? `${name} — ${summary.firstTabLabel}` : name
}

/** Main's registry numbers each window for its lifetime; read once per menu open. */
function useWorkbenchWindowEntries(): WorkbenchWindowEntry[] | null {
  const [entries, setEntries] = useState<WorkbenchWindowEntry[] | null>(null)
  useEffect(() => {
    let cancelled = false
    void window.api.workbenchWindows
      ?.listWindows()
      .then((listed) => {
        if (!cancelled) {
          setEntries(listed)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  return entries
}

function tabCountLabel(count: number, t: Translate): string {
  return count === 1
    ? t('components.tab.bar.MoveTabToWorkbenchWindowSubmenu.oneTab', '1 tab')
    : t('components.tab.bar.MoveTabToWorkbenchWindowSubmenu.tabCount', '{{count}} tabs', {
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
  const t = useTranslate()
  const detachedWindowIdByTabId = useAppStore((state) => state.detachedWindowIdByTabId)
  const unifiedTabsByWorktree = useAppStore((state) => state.unifiedTabsByWorktree)
  const tabsByWorktree = useAppStore((state) => state.tabsByWorktree)
  const openFiles = useAppStore((state) => state.openFiles)
  const settings = useAppStore((state) => state.settings)
  const entries = useWorkbenchWindowEntries()
  const summaries = useMemo((): OrderedSummary[] => {
    const ordinalByWindowId = new Map(entries?.map((entry) => [entry.windowId, entry.ordinal]))
    return summarizeWorkbenchWindows({
      detachedWindowIdByTabId,
      unifiedTabsByWorktree,
      tabsByWorktree,
      openFiles,
      settings
    })
      .filter(
        (summary) =>
          detachedWindowIdByTabId[unifiedTabId] !== summary.windowId &&
          (entries === null || ordinalByWindowId.has(summary.windowId))
      )
      .map((summary) => ({ ...summary, ordinal: ordinalByWindowId.get(summary.windowId) ?? null }))
      .toSorted((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0))
  }, [
    entries,
    detachedWindowIdByTabId,
    unifiedTabsByWorktree,
    tabsByWorktree,
    openFiles,
    settings,
    unifiedTabId
  ])
  if (summaries.length === 0) {
    return null
  }
  const { Sub, SubTrigger, SubContent, Item } = MENU_PARTS[menuKind]
  return (
    <Sub>
      <SubTrigger>
        <SquareStack className="size-3.5 shrink-0" />
        {t('components.tab.bar.MoveTabToWorkbenchWindowSubmenu.moveTo', 'Move to Window')}
      </SubTrigger>
      <SubContent className="max-w-80">
        {summaries.map((summary) => (
          <Item
            key={summary.windowId}
            disabled={summary.tabCount >= WORKBENCH_MAX_TABS}
            onSelect={() =>
              void moveTabsToExistingWorkbenchWindow([unifiedTabId], summary.windowId)
            }
          >
            <span className="min-w-0 truncate">{windowLabel(summary, t)}</span>
            <span className="ml-auto shrink-0 pl-3 text-2xs text-muted-foreground">
              {tabCountLabel(summary.tabCount, t)}
            </span>
          </Item>
        ))}
      </SubContent>
    </Sub>
  )
}
