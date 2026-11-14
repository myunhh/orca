import { Network } from 'lucide-react'
import { ContextMenuItem } from '@/components/ui/context-menu'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useTranslate } from '@/i18n/use-translate'
import { openAgentGraphForPane } from './agent-graph-target'

export function ShowAgentGraphMenuItem({
  paneKey,
  menuKind = 'dropdown'
}: {
  /** Resolved lazily so menus pick the pane at selection time. */
  paneKey: () => string | null
  menuKind?: 'dropdown' | 'context'
}): React.JSX.Element {
  const t = useTranslate()
  const Item = menuKind === 'context' ? ContextMenuItem : DropdownMenuItem
  return (
    <Item
      onSelect={() => {
        const key = paneKey()
        if (key) {
          openAgentGraphForPane(key)
        }
      }}
    >
      <Network className={menuKind === 'context' ? 'size-3.5 shrink-0' : undefined} />
      {t('components.agentGraph.ShowAgentGraphMenuItem.label', 'Show Agent Graph')}
    </Item>
  )
}
