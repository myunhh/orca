import { AppWindow } from 'lucide-react'
import { ContextMenuItem } from '@/components/ui/context-menu'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'
import {
  canShowTabInWorkbenchWindow,
  workbenchTabMoveRestriction
} from '../workbench-window/workbench-tab-eligibility'
import { moveTabsToNewWorkbenchWindow } from '../workbench-window/workbench-tab-move'
import { MoveTabToWorkbenchWindowSubmenu } from './MoveTabToWorkbenchWindowSubmenu'
import { isPairedWebClientWindow } from '@/app-shell/chrome/desktop-window-chrome'

export function MoveTabToNewWindowMenuItem({
  unifiedTabId,
  menuKind = 'dropdown'
}: {
  unifiedTabId: string
  menuKind?: 'dropdown' | 'context'
}): React.JSX.Element | null {
  const t = useTranslate()
  const eligible = useAppStore((state) => canShowTabInWorkbenchWindow(state, unifiedTabId))
  const restriction = useAppStore((state) =>
    !isPairedWebClientWindow() && window.api.workbenchWindows
      ? workbenchTabMoveRestriction(state, unifiedTabId)
      : null
  )
  const Item = menuKind === 'context' ? ContextMenuItem : DropdownMenuItem
  if (restriction) {
    return (
      <Item disabled className="max-w-80 flex-col items-start whitespace-normal">
        <span>{t('components.tab.bar.MoveTabToNewWindowMenuItem.move', 'Move to New Window')}</span>
        <span className="text-2xs text-muted-foreground">{restriction}</span>
      </Item>
    )
  }
  if (!eligible) {
    return null
  }
  return (
    <>
      <Item onSelect={() => void moveTabsToNewWorkbenchWindow([unifiedTabId])}>
        <AppWindow className="size-3.5 shrink-0" />
        {t('components.tab.bar.MoveTabToNewWindowMenuItem.move', 'Move to New Window')}
      </Item>
      <MoveTabToWorkbenchWindowSubmenu unifiedTabId={unifiedTabId} menuKind={menuKind} />
    </>
  )
}
