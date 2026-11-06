import type { AiVaultSubagentRunStatus } from '../ai-vault/contracts/ai-vault-types'

export type AgentGraphProvider = 'claude' | 'codex' | 'omp'

/** 'live' marks graphs built from hook rows for CLIs that have no transcript reader. */
export type AgentGraphSource = AgentGraphProvider | 'live'

export type AgentGraphNodeRole = 'root' | 'subagent' | 'workflow'

export type AgentGraphNode = {
  id: string
  provider: AgentGraphSource
  parentId: string | null
  role: AgentGraphNodeRole
  agentType: string | null
  label: string
  model: string | null
  status: AiVaultSubagentRunStatus | null
  /** Null for synthetic nodes such as a workflow group, which owns no transcript. */
  transcriptPath: string | null
  startedAt: string | null
  updatedAt: string | null
  totalTokens: number
  messageCount: number
  depth: number
}

export type AgentGraphEdgeKind = 'spawn' | 'message' | 'result'

export type AgentGraphEdge = {
  id: string
  from: string
  to: string
  kind: AgentGraphEdgeKind
  callId?: string
  /** Prompt, follow-up, or returned result; truncated to AGENT_GRAPH_EDGE_TEXT_MAX. */
  text?: string
  at: string | null
}

export type AgentGraphMessage = {
  id: string
  role: 'user' | 'assistant' | 'tool'
  text: string
  at: string | null
  model?: string
}

export type AgentGraph = {
  provider: AgentGraphSource
  rootSessionId: string
  /** Null for live graphs, which have no transcript. */
  rootTranscriptPath: string | null
  nodes: AgentGraphNode[]
  edges: AgentGraphEdge[]
  truncated: boolean
  issues: string[]
}

export type AgentGraphBuildArgs = {
  paneKey: string
  /** Renderer-known session identity; main admits the path against provider roots before reading. */
  fallback?: { provider: AgentGraphProvider; transcriptPath: string }
}

export type AgentGraphBuildResult =
  | { ok: true; graph: AgentGraph }
  | { ok: false; reason: AgentGraphUnavailableReason; message: string }

export type AgentGraphUnavailableReason =
  | 'no-session'
  | 'unsupported-agent'
  | 'remote-host'
  | 'not-admitted'
  | 'desktop-only'
  | 'unavailable'

export type AgentGraphNodeMessagesArgs = {
  provider: AgentGraphProvider
  transcriptPath: string
}

export type AgentGraphNodeMessagesResult =
  | {
      ok: true
      /** Present only when the window below skipped older messages that held the opening task. */
      openingPrompt: AgentGraphMessage | null
      messages: AgentGraphMessage[]
      truncated: boolean
    }
  | { ok: false; reason: AgentGraphNodeMessagesUnavailableReason; message: string }

export type AgentGraphNodeMessagesUnavailableReason =
  | 'invalid'
  | 'not-admitted'
  | 'desktop-only'
  | 'unavailable'

export const AGENT_GRAPH_MAX_NODES = 300
export const AGENT_GRAPH_MAX_DEPTH = 6
export const AGENT_GRAPH_EDGE_TEXT_MAX = 2048
export const AGENT_GRAPH_MESSAGE_LIMIT = 200
export const AGENT_GRAPH_MESSAGE_TEXT_MAX = 4096

export const AGENT_GRAPH_PROVIDERS: readonly AgentGraphProvider[] = ['claude', 'codex', 'omp']

export function isAgentGraphProvider(value: unknown): value is AgentGraphProvider {
  return value === 'claude' || value === 'codex' || value === 'omp'
}

export function truncateAgentGraphText(
  text: string | null | undefined,
  max = AGENT_GRAPH_EDGE_TEXT_MAX
): string | undefined {
  const trimmed = text?.trim()
  if (!trimmed) {
    return undefined
  }
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed
}
