import { useMemo } from 'react'
import { Bot, Network, Workflow } from 'lucide-react'
import type {
  AgentGraphEdge,
  AgentGraphNode
} from '../../../../shared/agent-graph/agent-graph-types'
import { formatSubagentTokens } from '../../../../shared/native-chat/transcript/native-chat-subagent-group-header'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import { AgentStateDot } from '../AgentStateDot'
import { agentGraphEdgeKindLabel, agentGraphStatusDotState } from './agent-graph-copy'
import {
  AGENT_GRAPH_NODE_HEIGHT,
  AGENT_GRAPH_NODE_WIDTH,
  layoutAgentGraph,
  type AgentGraphConnector
} from './agent-graph-layout'

type AgentGraphCanvasProps = {
  nodes: readonly AgentGraphNode[]
  edges: readonly AgentGraphEdge[]
  selectedNodeId: string | null
  onSelectNode: (nodeId: string) => void
}

export function AgentGraphCanvas({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode
}: AgentGraphCanvasProps): React.JSX.Element {
  const layout = useMemo(() => layoutAgentGraph(nodes, edges), [nodes, edges])
  const kindsByChild = useMemo(
    () => new Map(layout.connectors.map((connector) => [connector.childId, connector.kinds])),
    [layout]
  )
  return (
    <div className="scrollbar-sleek min-h-0 flex-1 overflow-auto">
      <div className="relative" style={{ width: layout.width, height: layout.height }}>
        <svg
          aria-hidden
          className="pointer-events-none absolute inset-0 text-muted-foreground"
          width={layout.width}
          height={layout.height}
        >
          {layout.connectors.map((connector) => (
            <AgentGraphConnectorPath
              key={connector.id}
              connector={connector}
              highlighted={connector.childId === selectedNodeId}
            />
          ))}
        </svg>
        {layout.placed.map(({ node, x, y }) => (
          <AgentGraphNodeCard
            key={node.id}
            node={node}
            x={x}
            y={y}
            selected={node.id === selectedNodeId}
            kinds={kindsByChild.get(node.id) ?? []}
            onSelect={onSelectNode}
          />
        ))}
      </div>
    </div>
  )
}

function AgentGraphConnectorPath({
  connector,
  highlighted
}: {
  connector: AgentGraphConnector
  highlighted: boolean
}): React.JSX.Element {
  return (
    <path
      d={connector.path}
      fill="none"
      stroke="currentColor"
      className={cn(highlighted ? 'text-ring' : 'text-border')}
      strokeWidth={highlighted ? 2 : 1.25}
    />
  )
}

function AgentGraphNodeCard({
  node,
  x,
  y,
  selected,
  kinds,
  onSelect
}: {
  node: AgentGraphNode
  x: number
  y: number
  selected: boolean
  kinds: AgentGraphConnector['kinds']
  onSelect: (nodeId: string) => void
}): React.JSX.Element {
  const t = useTranslate()
  const dot = agentGraphStatusDotState(node.status)
  const Icon = node.role === 'workflow' ? Workflow : node.role === 'root' ? Network : Bot
  const exchange = kinds
    .map(({ kind, count }) =>
      count > 1 ? `${agentGraphEdgeKindLabel(kind, t)} ×${count}` : agentGraphEdgeKindLabel(kind, t)
    )
    .join(' · ')
  return (
    <button
      type="button"
      onClick={() => onSelect(node.id)}
      aria-pressed={selected}
      className={cn(
        'absolute flex flex-col justify-center gap-0.5 overflow-hidden rounded-md border border-border bg-card px-2 text-left shadow-xs outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
        selected && 'ring-2 ring-ring'
      )}
      style={{ left: x, top: y, width: AGENT_GRAPH_NODE_WIDTH, height: AGENT_GRAPH_NODE_HEIGHT }}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {node.label}
        </span>
        {dot ? <AgentStateDot state={dot} /> : null}
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate font-mono">{node.model ?? ''}</span>
        {node.totalTokens > 0 ? (
          <span className="shrink-0">{formatSubagentTokens(node.totalTokens)}</span>
        ) : null}
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">
          {node.role === 'root'
            ? t('components.agentGraph.AgentGraphCanvas.mainAgent', 'Main agent')
            : (node.agentType ?? '')}
        </span>
        {exchange ? <span className="shrink-0">{exchange}</span> : null}
      </span>
    </button>
  )
}
