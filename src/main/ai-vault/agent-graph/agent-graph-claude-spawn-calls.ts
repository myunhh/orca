import type { AiVaultSubagentRunStatus } from '../../../shared/ai-vault/contracts/ai-vault-types'
import type {
  ClaudeSpawnCall,
  ClaudeSubagentParentLinks,
  ClaudeTaskOutcome
} from '../scanners/claude/claude-subagent-parent-links'
import type { AgentGraphAccumulator } from './agent-graph-accumulator'
import { claudeAgentNodeId } from './agent-graph-claude-ids'

const TERMINAL_STATUSES: Record<string, AiVaultSubagentRunStatus> = {
  completed: 'completed',
  failed: 'failed',
  killed: 'stopped',
  stopped: 'stopped'
}

function outcomeForToolUse(
  links: ClaudeSubagentParentLinks,
  toolUseId: string
): ClaudeTaskOutcome | undefined {
  for (const outcome of links.outcomesByAgentId.values()) {
    if (outcome.toolUseId === toolUseId) {
      return outcome
    }
  }
  return undefined
}

function spawnStatus(outcome: ClaudeTaskOutcome | undefined): AiVaultSubagentRunStatus {
  const status = outcome?.status ? TERMINAL_STATUSES[outcome.status] : undefined
  // A spawn with no reported outcome is still in flight in the parent's turn.
  return status ?? (outcome?.resultText ? 'completed' : 'running')
}

/**
 * Agent/Task calls whose child transcript was not found (still being written, or stored in a
 * layout this Claude version does not share) still belong on the graph: the parent transcript
 * alone names the agent type, model, prompt, and result.
 */
export function addClaudeSpawnCallNodes(
  acc: AgentGraphAccumulator,
  args: {
    parentNodeId: string
    depth: number
    links: ClaudeSubagentParentLinks
    representedToolUseIds: ReadonlySet<string>
  }
): void {
  const { links } = args
  const spawns = [...links.spawnsByToolUseId.values()].sort((left, right) =>
    (left.at ?? '').localeCompare(right.at ?? '')
  )
  for (const spawn of spawns) {
    if (args.representedToolUseIds.has(spawn.toolUseId)) {
      continue
    }
    const outcome = outcomeForToolUse(links, spawn.toolUseId)
    const nodeId = outcome ? claudeAgentNodeId(outcome.agentId) : `claude-call:${spawn.toolUseId}`
    if (acc.hasNode(nodeId)) {
      continue
    }
    addSpawnCallNode(acc, { ...args, spawn, outcome, nodeId })
  }
}

function addSpawnCallNode(
  acc: AgentGraphAccumulator,
  args: {
    parentNodeId: string
    depth: number
    links: ClaudeSubagentParentLinks
    spawn: ClaudeSpawnCall
    outcome: ClaudeTaskOutcome | undefined
    nodeId: string
  }
): void {
  const { spawn, outcome, nodeId } = args
  const node = acc.addNode({
    id: nodeId,
    parentId: args.parentNodeId,
    role: 'subagent',
    agentType: outcome?.agentType ?? spawn.subagentType,
    label: spawn.description ?? outcome?.agentType ?? spawn.subagentType ?? 'Subagent',
    model: outcome?.resolvedModel ?? spawn.model,
    status: spawnStatus(outcome),
    transcriptPath: null,
    startedAt: spawn.at,
    updatedAt: outcome?.at ?? spawn.at,
    totalTokens: 0,
    messageCount: 0,
    depth: args.depth
  })
  if (!node) {
    return
  }
  acc.addEdge({
    from: args.parentNodeId,
    to: nodeId,
    kind: 'spawn',
    callId: spawn.toolUseId,
    text: spawn.prompt,
    at: spawn.at
  })
  const agentId = outcome?.agentId
  for (const message of args.links.messages) {
    if (agentId && message.to === agentId) {
      acc.addEdge({
        from: args.parentNodeId,
        to: nodeId,
        kind: 'message',
        callId: message.toolUseId,
        text: message.text,
        at: message.at
      })
    }
  }
  const resultText =
    outcome?.resultText ?? (agentId ? args.links.notificationsByTaskId.get(agentId)?.summary : null)
  if (resultText) {
    acc.addEdge({
      from: nodeId,
      to: args.parentNodeId,
      kind: 'result',
      callId: spawn.toolUseId,
      text: resultText,
      at: outcome?.at ?? null
    })
  }
}
