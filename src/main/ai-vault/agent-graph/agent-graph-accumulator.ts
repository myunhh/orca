import { basename } from 'node:path'
import type {
  AiVaultScanIssue,
  AiVaultSession
} from '../../../shared/ai-vault/contracts/ai-vault-types'
import {
  AGENT_GRAPH_MAX_DEPTH,
  AGENT_GRAPH_MAX_NODES,
  truncateAgentGraphText,
  type AgentGraph,
  type AgentGraphEdge,
  type AgentGraphNode,
  type AgentGraphProvider
} from '../../../shared/agent-graph/agent-graph-types'

import { throwIfAiVaultScanCancelled } from '../ai-vault-scan-cancellation'

const MAX_ISSUES = 20

/** Collects nodes and edges under the shared caps so every provider builder truncates the same way. */
export class AgentGraphAccumulator {
  readonly nodes: AgentGraphNode[] = []
  readonly edges: AgentGraphEdge[] = []
  readonly issues: string[] = []
  truncated = false
  private readonly nodeIds = new Set<string>()

  constructor(
    readonly provider: AgentGraphProvider,
    private readonly signal?: AbortSignal
  ) {}

  /** Builders check before each transcript read so a superseded build stops between files. */
  canDescend(depth: number): boolean {
    throwIfAiVaultScanCancelled(this.signal)
    if (depth > AGENT_GRAPH_MAX_DEPTH) {
      this.truncated = true
      return false
    }
    return this.nodes.length < AGENT_GRAPH_MAX_NODES
  }

  hasNode(id: string): boolean {
    return this.nodeIds.has(id)
  }

  addNode(node: Omit<AgentGraphNode, 'provider'>): AgentGraphNode | null {
    throwIfAiVaultScanCancelled(this.signal)
    if (this.nodeIds.has(node.id)) {
      return null
    }
    if (this.nodes.length >= AGENT_GRAPH_MAX_NODES || node.depth > AGENT_GRAPH_MAX_DEPTH) {
      this.truncated = true
      return null
    }
    const added = { ...node, provider: this.provider }
    this.nodeIds.add(node.id)
    this.nodes.push(added)
    return added
  }

  addEdge(edge: Omit<AgentGraphEdge, 'id' | 'text'> & { text?: string | null }): void {
    if (!this.nodeIds.has(edge.from) || !this.nodeIds.has(edge.to)) {
      return
    }
    const text = truncateAgentGraphText(edge.text)
    this.edges.push({
      id: `${edge.kind}:${edge.from}>${edge.to}:${this.edges.length}`,
      from: edge.from,
      to: edge.to,
      kind: edge.kind,
      at: edge.at,
      ...(edge.callId ? { callId: edge.callId } : {}),
      ...(text ? { text } : {})
    })
  }

  addIssue(message: string): void {
    if (this.issues.length < MAX_ISSUES && !this.issues.includes(message)) {
      this.issues.push(message)
    }
  }

  addScanIssues(issues: readonly AiVaultScanIssue[]): void {
    for (const issue of issues) {
      this.addIssue(`${basename(issue.path)}: ${issue.message}`)
    }
  }

  finish(rootSessionId: string, rootTranscriptPath: string): AgentGraph {
    return {
      provider: this.provider,
      rootSessionId,
      rootTranscriptPath,
      nodes: this.nodes,
      edges: this.edges,
      truncated: this.truncated,
      issues: this.issues
    }
  }
}

/** Shared node fields for any transcript the vault parsers already summarized. */
export function agentGraphNodeFieldsFromSession(
  session: AiVaultSession
): Pick<
  AgentGraphNode,
  | 'label'
  | 'model'
  | 'status'
  | 'transcriptPath'
  | 'startedAt'
  | 'updatedAt'
  | 'totalTokens'
  | 'messageCount'
> {
  return {
    label: session.title,
    model: session.model,
    status: session.subagent?.status ?? null,
    transcriptPath: session.filePath,
    startedAt: session.createdAt,
    updatedAt: session.updatedAt ?? session.modifiedAt,
    totalTokens: session.totalTokens,
    messageCount: session.messageCount
  }
}

/** The newest assistant preview approximates what a child handed back when no explicit result exists. */
export function lastAssistantPreview(session: AiVaultSession): string | null {
  for (let index = session.previewMessages.length - 1; index >= 0; index -= 1) {
    const message = session.previewMessages[index]
    if (message?.role === 'assistant' && message.text.trim()) {
      return message.text
    }
  }
  return null
}
