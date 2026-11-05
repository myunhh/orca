import { Loader2 } from 'lucide-react'
import { AgentTerminalPreview } from '@/components/dashboard-popout/AgentTerminalPreview'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type {
  WorkbenchTerminalPane,
  WorkbenchTerminalTabView
} from '../../../../shared/workbench-window/workbench-window-types'
import type { TerminalPaneLayoutNode } from '../../../../shared/workspace-layout/terminal-tab-types'

function WorkbenchTerminalPaneView({
  pane,
  isActiveLeaf,
  showFrame
}: {
  pane: WorkbenchTerminalPane | undefined
  isActiveLeaf: boolean
  showFrame: boolean
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'relative flex min-h-0 min-w-0 flex-1 overflow-hidden',
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
    </div>
  )
}

function LayoutNodeView({
  node,
  panesByLeafId,
  activeLeafId,
  showFrame
}: {
  node: TerminalPaneLayoutNode
  panesByLeafId: ReadonlyMap<string, WorkbenchTerminalPane>
  activeLeafId: string | null
  showFrame: boolean
}): React.JSX.Element {
  if (node.type === 'leaf') {
    return (
      <WorkbenchTerminalPaneView
        pane={panesByLeafId.get(node.leafId)}
        isActiveLeaf={node.leafId === activeLeafId}
        showFrame={showFrame}
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
        />
      </div>
      <div className="flex min-h-0 min-w-0" style={{ flex: `${1 - ratio} 1 0` }}>
        <LayoutNodeView
          node={node.second}
          panesByLeafId={panesByLeafId}
          activeLeafId={activeLeafId}
          showFrame={showFrame}
        />
      </div>
    </div>
  )
}

/** Live, interactive mirrors of a main-owned terminal tab's panes, laid out like the main window. */
export function WorkbenchTerminalBody({
  terminal
}: {
  terminal: WorkbenchTerminalTabView
}): React.JSX.Element {
  const panesByLeafId = new Map(terminal.panes.map((pane) => [pane.leafId, pane]))
  if (!terminal.root || terminal.root.type === 'leaf') {
    const leafId = terminal.root?.leafId ?? terminal.panes[0]?.leafId
    return (
      <div className="flex min-h-0 min-w-0 flex-1">
        <WorkbenchTerminalPaneView
          pane={leafId ? panesByLeafId.get(leafId) : undefined}
          isActiveLeaf
          showFrame={false}
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
      />
    </div>
  )
}
