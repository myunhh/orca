import { Loader2, PanelBottomClose, SquareSplitVertical } from 'lucide-react'
import { AgentTerminalPreview } from '@/components/dashboard-popout/AgentTerminalPreview'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type {
  WorkbenchSplitDirection,
  WorkbenchTerminalPane,
  WorkbenchTerminalTabView
} from '../../../../shared/workbench-window/workbench-window-types'
import type { TerminalPaneLayoutNode } from '../../../../shared/workspace-layout/terminal-tab-types'
import { sendWorkbenchCommand } from './workbench-window-commands'

type SplitPane = (leafId: string, direction: WorkbenchSplitDirection) => void

function PaneSplitButton({
  direction,
  onSplit
}: {
  direction: WorkbenchSplitDirection
  onSplit: (direction: WorkbenchSplitDirection) => void
}): React.JSX.Element {
  const label =
    direction === 'vertical'
      ? translate(
          'auto.components.terminal.pane.TerminalContextMenu.20e565d865',
          'Split Terminal Right'
        )
      : translate(
          'auto.components.terminal.pane.TerminalContextMenu.98bccf4fa2',
          'Split Terminal Down'
        )
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          onClick={() => onSplit(direction)}
        >
          {direction === 'vertical' ? <SquareSplitVertical /> : <PanelBottomClose />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

function WorkbenchTerminalPaneView({
  pane,
  isActiveLeaf,
  showFrame,
  onSplitPane
}: {
  pane: WorkbenchTerminalPane | undefined
  isActiveLeaf: boolean
  showFrame: boolean
  onSplitPane: SplitPane
}): React.JSX.Element {
  // Why only a started pane: main splits from a live pane, the same as its own split button.
  const split = pane?.ptyId
    ? (direction: WorkbenchSplitDirection) => onSplitPane(pane.leafId, direction)
    : undefined
  return (
    <div
      className={cn(
        'group/pane relative flex min-h-0 min-w-0 flex-1 overflow-hidden',
        showFrame && 'border border-border',
        showFrame && isActiveLeaf && 'border-ring'
      )}
    >
      {pane?.ptyId ? (
        <AgentTerminalPreview
          // Remount on a new PTY so the preview reconnects with a fresh snapshot.
          key={pane.ptyId}
          ptyId={pane.ptyId}
          terminalInput={pane.terminalInput}
          onRequestSplit={split}
          className="min-h-0 flex-1"
        />
      ) : (
        <div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {translate(
            'components.workbench.window.WorkbenchTerminalBody.starting',
            'Waiting for the terminal to start…'
          )}
        </div>
      )}
      {split ? (
        <div className="absolute right-1 top-1 z-10 flex items-center gap-0.5 rounded-md border border-border bg-background/90 opacity-0 shadow-xs transition-opacity group-hover/pane:opacity-100 focus-within:opacity-100">
          <PaneSplitButton direction="vertical" onSplit={split} />
          <PaneSplitButton direction="horizontal" onSplit={split} />
        </div>
      ) : null}
    </div>
  )
}

function LayoutNodeView({
  node,
  panesByLeafId,
  activeLeafId,
  showFrame,
  onSplitPane
}: {
  node: TerminalPaneLayoutNode
  panesByLeafId: ReadonlyMap<string, WorkbenchTerminalPane>
  activeLeafId: string | null
  showFrame: boolean
  onSplitPane: SplitPane
}): React.JSX.Element {
  if (node.type === 'leaf') {
    return (
      <WorkbenchTerminalPaneView
        pane={panesByLeafId.get(node.leafId)}
        isActiveLeaf={node.leafId === activeLeafId}
        showFrame={showFrame}
        onSplitPane={onSplitPane}
      />
    )
  }
  const ratio = Math.min(0.9, Math.max(0.1, node.ratio ?? 0.5))
  return (
    <div
      className={cn(
        'flex min-h-0 min-w-0 flex-1 gap-px',
        node.direction === 'vertical' ? 'flex-row' : 'flex-col'
      )}
    >
      <div className="flex min-h-0 min-w-0" style={{ flex: `${ratio} 1 0` }}>
        <LayoutNodeView
          node={node.first}
          panesByLeafId={panesByLeafId}
          activeLeafId={activeLeafId}
          showFrame={showFrame}
          onSplitPane={onSplitPane}
        />
      </div>
      <div className="flex min-h-0 min-w-0" style={{ flex: `${1 - ratio} 1 0` }}>
        <LayoutNodeView
          node={node.second}
          panesByLeafId={panesByLeafId}
          activeLeafId={activeLeafId}
          showFrame={showFrame}
          onSplitPane={onSplitPane}
        />
      </div>
    </div>
  )
}

/** Live, interactive mirrors of a main-owned terminal tab's panes, laid out like the main window. */
export function WorkbenchTerminalBody({
  tabId,
  terminal
}: {
  tabId: string
  terminal: WorkbenchTerminalTabView
}): React.JSX.Element {
  // The main window owns the layout and PTYs; the split arrives in the next snapshot.
  const splitPane: SplitPane = (leafId, direction) =>
    sendWorkbenchCommand({ kind: 'splitTerminalPane', tabId, leafId, direction })
  const panesByLeafId = new Map(terminal.panes.map((pane) => [pane.leafId, pane]))
  if (!terminal.root || terminal.root.type === 'leaf') {
    const leafId = terminal.root?.leafId ?? terminal.panes[0]?.leafId
    return (
      <div className="flex min-h-0 min-w-0 flex-1">
        <WorkbenchTerminalPaneView
          pane={leafId ? panesByLeafId.get(leafId) : undefined}
          isActiveLeaf
          showFrame={false}
          onSplitPane={splitPane}
        />
      </div>
    )
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-1 p-px">
      <LayoutNodeView
        node={terminal.root}
        panesByLeafId={panesByLeafId}
        activeLeafId={terminal.activeLeafId}
        showFrame
        onSplitPane={splitPane}
      />
    </div>
  )
}
