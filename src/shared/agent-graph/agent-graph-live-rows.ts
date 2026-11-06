import type { AiVaultSubagentRunStatus } from '../ai-vault/contracts/ai-vault-types'
import {
  AGENT_GRAPH_MAX_NODES,
  truncateAgentGraphText,
  type AgentGraph,
  type AgentGraphEdge,
  type AgentGraphNode
} from './agent-graph-types'

export const LIVE_GRAPH_ROOT_NODE_ID = 'root'

export type LiveGraphChild = {
  id: string
  agentType: string | null
  model: string | null
  description: string | null
  status: AiVaultSubagentRunStatus | null
  firstSeenMs: number
  lastSeenMs: number
}

export type LiveGraphRoot = {
  paneKey: string
  sessionId: string | null
  agentType: string | null
  model: string | null
  prompt: string | null
  status: AiVaultSubagentRunStatus | null
  startedMs: number | null
  updatedMs: number
}

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString())

/** Hook rows name sub-agents but carry no transcripts, so nodes show who ran, not what was said. */
export function buildLiveAgentGraph(
  root: LiveGraphRoot,
  children: readonly LiveGraphChild[]
): AgentGraph {
  const nodes: AgentGraphNode[] = [
    {
      id: LIVE_GRAPH_ROOT_NODE_ID,
      provider: 'live',
      parentId: null,
      role: 'root',
      agentType: root.agentType,
      label:
        truncateAgentGraphText(root.prompt?.split('\n')[0], 120) ?? root.agentType ?? root.paneKey,
      model: root.model,
      status: root.status,
      transcriptPath: null,
      startedAt: iso(root.startedMs),
      updatedAt: iso(root.updatedMs),
      totalTokens: 0,
      messageCount: 0,
      depth: 0
    }
  ]
  const edges: AgentGraphEdge[] = []
  const shown = [...children].sort((left, right) => left.firstSeenMs - right.firstSeenMs)
  const truncated = shown.length + 1 > AGENT_GRAPH_MAX_NODES
  for (const child of shown.slice(0, AGENT_GRAPH_MAX_NODES - 1)) {
    const nodeId = `live:${child.id}`
    nodes.push({
      id: nodeId,
      provider: 'live',
      parentId: LIVE_GRAPH_ROOT_NODE_ID,
      role: 'subagent',
      agentType: child.agentType,
      label: child.description?.split('\n')[0] ?? child.agentType ?? child.id,
      model: child.model,
      status: child.status,
      transcriptPath: null,
      startedAt: iso(child.firstSeenMs),
      updatedAt: iso(child.lastSeenMs),
      totalTokens: 0,
      messageCount: 0,
      depth: 1
    })
    const text = truncateAgentGraphText(child.description)
    edges.push({
      id: `spawn:${nodeId}`,
      from: LIVE_GRAPH_ROOT_NODE_ID,
      to: nodeId,
      kind: 'spawn',
      at: iso(child.firstSeenMs),
      ...(text ? { text } : {})
    })
  }
  return {
    provider: 'live',
    rootSessionId: root.sessionId ?? root.paneKey,
    rootTranscriptPath: null,
    nodes,
    edges,
    truncated,
    issues: [
      'Live view: sub-agents come from agent hooks, so only names and states are shown, not their conversations.'
    ]
  }
}
