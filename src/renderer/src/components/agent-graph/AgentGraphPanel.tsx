import { useEffect, useMemo, useState } from 'react'
import { Loader2, Network, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAppStore } from '@/store'
import { useTranslate } from '@/i18n/use-translate'
import { AgentGraphCanvas } from './AgentGraphCanvas'
import { AgentGraphNodeDetail } from './AgentGraphNodeDetail'
import { agentGraphIssuesSummary, agentGraphUnavailableCopy } from './agent-graph-copy'
import {
  activeTerminalPaneKey,
  agentGraphPaneOptions,
  resolveAgentGraphPaneKey
} from './agent-graph-pane-options'
import { setAgentGraphTargetPane, useAgentGraphTargetStore } from './agent-graph-target'
import { useAgentGraph } from './use-agent-graph'

// Radix Select needs a non-empty value; real pane keys always contain a ':' separator.
const FOLLOW_ACTIVE_PANE = 'follow-active-pane'

export default function AgentGraphPanel({ isVisible }: { isVisible: boolean }): React.JSX.Element {
  const t = useTranslate()
  const statuses = useAppStore((s) => s.agentStatusByPaneKey)
  const activePaneKey = useAppStore(activeTerminalPaneKey)
  const targetPaneKey = useAgentGraphTargetStore((s) => s.paneKey)
  const options = useMemo(() => agentGraphPaneOptions(statuses), [statuses])
  const paneKey = resolveAgentGraphPaneKey({ targetPaneKey, activePaneKey, options })
  const selectedOption = options.find((option) => option.paneKey === paneKey)
  const targetIsLive = options.some((option) => option.paneKey === targetPaneKey)
  useEffect(() => {
    // A closed or no-longer-agent target falls back to following the active pane.
    if (targetPaneKey && !targetIsLive) {
      setAgentGraphTargetPane(null)
    }
  }, [targetPaneKey, targetIsLive])
  const { result, loading, refresh } = useAgentGraph({
    paneKey,
    fallback: selectedOption?.fallback,
    isVisible
  })
  const [selection, setSelection] = useState<{ paneKey: string | null; nodeId: string } | null>(
    null
  )
  const graph = result?.ok ? result.graph : null
  const selectedNode =
    selection?.paneKey === paneKey
      ? (graph?.nodes.find((node) => node.id === selection.nodeId) ?? null)
      : null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border px-2">
        <Select
          value={targetIsLive && targetPaneKey ? targetPaneKey : FOLLOW_ACTIVE_PANE}
          onValueChange={(value) =>
            setAgentGraphTargetPane(value === FOLLOW_ACTIVE_PANE ? null : value)
          }
          disabled={options.length === 0}
        >
          <SelectTrigger size="sm" className="min-w-0 flex-1">
            <SelectValue
              placeholder={t(
                'components.agentGraph.AgentGraphPanel.pickPane',
                'Choose an agent pane'
              )}
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={FOLLOW_ACTIVE_PANE}>
              <span className="truncate">
                {t('components.agentGraph.AgentGraphPanel.followActivePane', 'Follow active pane')}
              </span>
              {!targetIsLive && selectedOption ? (
                <span className="truncate text-2xs text-muted-foreground">
                  {selectedOption.label}
                </span>
              ) : null}
            </SelectItem>
            {options.map((option) => (
              <SelectItem key={option.paneKey} value={option.paneKey}>
                <span className="truncate">{option.label}</span>
                {option.agentType ? (
                  <span className="text-2xs text-muted-foreground">{option.agentType}</span>
                ) : null}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={refresh}
              disabled={!paneKey}
              aria-label={t('components.agentGraph.AgentGraphPanel.refresh', 'Refresh graph')}
            >
              {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            {t('components.agentGraph.AgentGraphPanel.refresh', 'Refresh graph')}
          </TooltipContent>
        </Tooltip>
      </div>
      {graph ? (
        <>
          {graph.truncated || graph.issues.length > 0 ? (
            <div className="shrink-0 border-b border-border px-3 py-1.5 text-2xs text-muted-foreground">
              {graph.truncated
                ? t(
                    'components.agentGraph.AgentGraphPanel.truncated',
                    'Showing the first agents only; the graph hit its size limit.'
                  )
                : null}
              {graph.issues.length > 0 ? (
                <div className="truncate" title={graph.issues.join('\n')}>
                  {agentGraphIssuesSummary(graph.issues.length, t)}
                </div>
              ) : null}
            </div>
          ) : null}
          <AgentGraphCanvas
            nodes={graph.nodes}
            edges={graph.edges}
            selectedNodeId={selectedNode?.id ?? null}
            onSelectNode={(nodeId) => setSelection({ paneKey, nodeId })}
          />
          {selectedNode ? (
            <AgentGraphNodeDetail
              key={selectedNode.id}
              node={selectedNode}
              edges={graph.edges}
              onClose={() => setSelection(null)}
            />
          ) : null}
        </>
      ) : (
        <AgentGraphEmptyState
          message={
            !paneKey
              ? t(
                  'components.agentGraph.AgentGraphPanel.noPanes',
                  'Start Claude Code, Codex, or OMP in a terminal to see which agents it calls.'
                )
              : result && !result.ok
                ? agentGraphUnavailableCopy(result, t)
                : null
          }
        />
      )}
    </div>
  )
}

function AgentGraphEmptyState({ message }: { message: string | null }): React.JSX.Element {
  const t = useTranslate()
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
      {message ? <Network className="size-8 opacity-50" /> : <Loader2 className="animate-spin" />}
      <p className="text-xs">
        {message ??
          t('components.agentGraph.AgentGraphPanel.loading', 'Reading agent transcripts…')}
      </p>
    </div>
  )
}
