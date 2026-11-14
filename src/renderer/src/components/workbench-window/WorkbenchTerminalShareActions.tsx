import { Link2, Share2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslate } from '@/i18n/use-translate'
import type { WorkbenchTabView } from '../../../../shared/workbench-window/workbench-window-types'
import { parsePaneKey } from '../../../../shared/workspace-layout/stable-pane-id'
import {
  openTerminalContextShareDialog,
  type TerminalContextShareKind,
  type TerminalContextShareSource
} from '../terminal-context-share/terminal-context-share-request'
import type { WorkbenchPaneHeaderActionRenderer } from './workbench-pane-header-actions'

function activePane(tab: WorkbenchTabView): {
  tabId: string
  leafId: string
  ptyId: string | null
  title: string | null
} | null {
  const terminal = tab.terminal
  if (!terminal) {
    return null
  }
  const pane =
    terminal.panes.find((candidate) => candidate.leafId === terminal.activeLeafId) ??
    terminal.panes[0]
  // The pane key carries the terminal tab id that handle resolution needs (unified ids differ).
  const parsed = pane?.paneKey ? parsePaneKey(pane.paneKey) : null
  return parsed
    ? { tabId: parsed.tabId, leafId: parsed.leafId, ptyId: pane.ptyId, title: pane.title }
    : null
}

function shareSource(tab: WorkbenchTabView): TerminalContextShareSource | null {
  const pane = activePane(tab)
  if (!pane || !tab.terminal) {
    return null
  }
  return {
    tabId: pane.tabId,
    leafId: pane.leafId,
    ptyId: pane.ptyId,
    worktreeId: tab.worktreeId,
    title: pane.title || tab.label,
    runtimeEnvironmentId: tab.terminal.runtimeEnvironmentId
  }
}

function ShareActionButton({
  kind,
  label,
  onOpen
}: {
  kind: TerminalContextShareKind
  label: string
  onOpen: (kind: TerminalContextShareKind) => void
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={label} onClick={() => onOpen(kind)}>
          {kind === 'share' ? <Share2 /> : <Link2 />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

/** Split-view header buttons: share this terminal's context with, or link it to, the other half. */
function WorkbenchTerminalShareActions({
  tab,
  partner
}: {
  tab: WorkbenchTabView
  partner: WorkbenchTabView | null
}): React.JSX.Element | null {
  const t = useTranslate()
  const source = shareSource(tab)
  if (!source) {
    return null
  }
  const partnerPane = partner ? activePane(partner) : null
  const preferredTarget = partnerPane
    ? { tabId: partnerPane.tabId, leafId: partnerPane.leafId }
    : undefined
  const onOpen = (kind: TerminalContextShareKind): void =>
    openTerminalContextShareDialog(kind, source, preferredTarget)
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <ShareActionButton
        kind="share"
        label={
          partnerPane
            ? t(
                'components.workbenchWindow.WorkbenchTerminalShareActions.shareToPartner',
                'Share Context to Other Pane…'
              )
            : t(
                'components.workbenchWindow.WorkbenchTerminalShareActions.share',
                'Share Context to Terminal…'
              )
        }
        onOpen={onOpen}
      />
      <ShareActionButton
        kind="link"
        label={
          partnerPane
            ? t(
                'components.workbenchWindow.WorkbenchTerminalShareActions.linkToPartner',
                'Link with Other Pane…'
              )
            : t(
                'components.workbenchWindow.WorkbenchTerminalShareActions.link',
                'Link with Terminal…'
              )
        }
        onOpen={onOpen}
      />
    </div>
  )
}

export const renderWorkbenchTerminalShareActions: WorkbenchPaneHeaderActionRenderer = ({
  tab,
  partner
}) => <WorkbenchTerminalShareActions tab={tab} partner={partner} />
