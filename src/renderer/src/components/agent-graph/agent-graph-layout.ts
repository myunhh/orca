import type {
  AgentGraphEdge,
  AgentGraphEdgeKind,
  AgentGraphNode
} from '../../../../shared/agent-graph/agent-graph-types'

export const AGENT_GRAPH_NODE_WIDTH = 232
export const AGENT_GRAPH_NODE_HEIGHT = 64
const INDENT = 28
const ROW_GAP = 14
const PADDING = 12
// The connector trunk drops from this offset inside the parent card.
const TRUNK_OFFSET = 14

export type AgentGraphPlacedNode = { node: AgentGraphNode; x: number; y: number }

export type AgentGraphConnector = {
  id: string
  childId: string
  path: string
  /** Edge kinds between this parent/child pair in either direction, in display order. */
  kinds: { kind: AgentGraphEdgeKind; count: number }[]
}

export type AgentGraphLayout = {
  width: number
  height: number
  placed: AgentGraphPlacedNode[]
  connectors: AgentGraphConnector[]
}

const KIND_ORDER: AgentGraphEdgeKind[] = ['spawn', 'message', 'result']

/** Indented tidy tree: rows in depth-first order so a narrow sidebar never needs wide fan-outs. */
export function layoutAgentGraph(
  nodes: readonly AgentGraphNode[],
  edges: readonly AgentGraphEdge[]
): AgentGraphLayout {
  const ids = new Set(nodes.map((node) => node.id))
  const childrenByParent = new Map<string | null, AgentGraphNode[]>()
  for (const node of nodes) {
    const parent = node.parentId && ids.has(node.parentId) ? node.parentId : null
    const siblings = childrenByParent.get(parent) ?? []
    siblings.push(node)
    childrenByParent.set(parent, siblings)
  }
  const placed: AgentGraphPlacedNode[] = []
  const positions = new Map<string, AgentGraphPlacedNode>()
  const visit = (node: AgentGraphNode, level: number): void => {
    const entry = {
      node,
      x: PADDING + level * INDENT,
      y: PADDING + placed.length * (AGENT_GRAPH_NODE_HEIGHT + ROW_GAP)
    }
    placed.push(entry)
    positions.set(node.id, entry)
    for (const child of childrenByParent.get(node.id) ?? []) {
      visit(child, level + 1)
    }
  }
  for (const root of childrenByParent.get(null) ?? []) {
    visit(root, 0)
  }

  const connectors: AgentGraphConnector[] = []
  for (const entry of placed) {
    const parent = entry.node.parentId ? positions.get(entry.node.parentId) : undefined
    if (!parent) {
      continue
    }
    const trunkX = parent.x + TRUNK_OFFSET
    const midY = entry.y + AGENT_GRAPH_NODE_HEIGHT / 2
    connectors.push({
      id: `${parent.node.id}>${entry.node.id}`,
      childId: entry.node.id,
      path: `M ${trunkX} ${parent.y + AGENT_GRAPH_NODE_HEIGHT} V ${midY} H ${entry.x}`,
      kinds: edgeKindsBetween(edges, parent.node.id, entry.node.id)
    })
  }

  const maxX = placed.reduce((max, entry) => Math.max(max, entry.x), 0)
  return {
    width: maxX + AGENT_GRAPH_NODE_WIDTH + PADDING,
    height: PADDING * 2 + Math.max(placed.length, 1) * (AGENT_GRAPH_NODE_HEIGHT + ROW_GAP),
    placed,
    connectors
  }
}

function edgeKindsBetween(
  edges: readonly AgentGraphEdge[],
  parentId: string,
  childId: string
): AgentGraphConnector['kinds'] {
  const counts = new Map<AgentGraphEdgeKind, number>()
  for (const edge of edges) {
    const linksPair =
      (edge.from === parentId && edge.to === childId) ||
      (edge.from === childId && edge.to === parentId)
    if (linksPair) {
      counts.set(edge.kind, (counts.get(edge.kind) ?? 0) + 1)
    }
  }
  return KIND_ORDER.flatMap((kind) => {
    const count = counts.get(kind)
    return count ? [{ kind, count }] : []
  })
}

/** Edges that describe one node: what its parent sent it, and what it sent back. */
export function agentGraphNodeEdges(
  edges: readonly AgentGraphEdge[],
  node: AgentGraphNode
): { incoming: AgentGraphEdge[]; results: AgentGraphEdge[] } {
  const incoming: AgentGraphEdge[] = []
  const results: AgentGraphEdge[] = []
  for (const edge of edges) {
    if (edge.to === node.id && edge.from === node.parentId) {
      incoming.push(edge)
    } else if (edge.from === node.id && edge.kind === 'result') {
      results.push(edge)
    }
  }
  return { incoming, results }
}
