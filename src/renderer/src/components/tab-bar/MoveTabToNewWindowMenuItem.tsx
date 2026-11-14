import { AppWindow } from 'lucide-react'
import { ContextMenuItem } from '@/components/ui/context-menu'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'
import { canShowTabInWorkbenchWindow } from '../workbench-window/workbench-tab-eligibility'
import { moveTabsToNewWorkbenchWindow } from '../workbench-window/workbench-tab-move'
import { MoveTabToWorkbenchWindowSubmenu } from './MoveTabToWorkbenchWindowSubmenu'

export function MoveTabToNewWindowMenuItem({
  unifiedTabId,
  menuKind = 'dropdown'
}: {
  unifiedTabId: string
  menuKind?: 'dropdown' | 'context'
}): React.JSX.Element | null {
  const t = useTranslate()
  const eligible = useAppStore((state) => canShowTabInWorkbenchWindow(state, unifiedTabId))
  if (!eligible) {
    return null
  }
  const Item = menuKind === 'context' ? ContextMenuItem : DropdownMenuItem
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
