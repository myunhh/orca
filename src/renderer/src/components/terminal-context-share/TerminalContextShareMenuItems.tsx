import { Link2, Share2 } from 'lucide-react'
import { ContextMenuItem } from '@/components/ui/context-menu'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import type { TerminalContextShareKind } from './terminal-context-share-request'

/** "Share Context…" and "Link Terminals…" rows for terminal pane and tab menus. */
export function TerminalContextShareMenuItems({
  menuKind,
  onOpen
}: {
  menuKind: 'dropdown' | 'context'
  onOpen: (kind: TerminalContextShareKind) => void
}): React.JSX.Element {
  const Item = menuKind === 'context' ? ContextMenuItem : DropdownMenuItem
  const iconClass = menuKind === 'context' ? 'size-3.5 shrink-0' : undefined
  return (
    <>
      <Item onSelect={() => onOpen('share')}>
        <Share2 className={iconClass} />
        {translate('components.terminalContextShare.menuShare', 'Share Context to Terminal…')}
      </Item>
      <Item onSelect={() => onOpen('link')}>
        <Link2 className={iconClass} />
        {translate('components.terminalContextShare.menuLink', 'Link with Terminal…')}
      </Item>
    </>
  )
}
