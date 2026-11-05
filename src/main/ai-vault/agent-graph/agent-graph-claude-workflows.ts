import { dirname, join } from 'node:path'
import type {
  AiVaultSession,
  AiVaultSubagentRunStatus
} from '../../../shared/ai-vault/contracts/ai-vault-types'
import { wslGatedReaddir } from '../../native-chat/wsl-transcript-fs-access'
import type { ClaudeSubagentParentLinks } from '../scanners/claude/claude-subagent-parent-links'
import { listClaudeSubagentSessions } from '../scanners/claude/session-scanner-claude-subagents'
import { subagentTranscriptsDirFor } from '../scanners/claude/session-scanner-subagent-transcripts'
import {
  agentGraphNodeFieldsFromSession,
  type AgentGraphAccumulator
} from './agent-graph-accumulator'
import {
  claudeAgentIdFromPath,
  claudeAgentNodeId,
  claudeWorkflowNodeId,
  claudeWorkflowsDirFor,
  oldestFirst,
  type ClaudeDescend
} from './agent-graph-claude-ids'
import {
  readClaudeWorkflowJournal,
  readClaudeWorkflowRecord,
  type ClaudeWorkflowJournalAgent
} from './agent-graph-claude-workflow-files'

const RUN_STATUS: Record<string, AiVaultSubagentRunStatus> = {
  completed: 'completed',
  failed: 'failed',
  killed: 'stopped',
  stopped: 'stopped',
  cancelled: 'stopped'
}

/** Each run dir becomes a workflow node under the launching agent, with its agents beneath it. */
export async function addClaudeWorkflowNodes(
  acc: AgentGraphAccumulator,
  args: {
    parentNodeId: string
    parentPath: string
    depth: number
    links: ClaudeSubagentParentLinks
    descend: ClaudeDescend
  }
): Promise<void> {
  let runIds: string[]
  try {
    const entries = await wslGatedReaddir(claudeWorkflowsDirFor(args.parentPath), 'scan')
    runIds = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch {
    return
  }
  for (const runId of runIds) {
    if (!acc.canDescend(args.depth)) {
      return
    }
    await addWorkflowRun(acc, { ...args, runId })
  }
}

async function addWorkflowRun(
  acc: AgentGraphAccumulator,
  args: {
    parentNodeId: string
    parentPath: string
    depth: number
    links: ClaudeSubagentParentLinks
    descend: ClaudeDescend
    runId: string
  }
): Promise<void> {
  const runDir = join(claudeWorkflowsDirFor(args.parentPath), args.runId)
  const launch = args.links.workflowsByRunId.get(args.runId)
  const notification = launch?.taskId ? args.links.notificationsByTaskId.get(launch.taskId) : null
  const [journal, record] = await Promise.all([
    readClaudeWorkflowJournal(join(runDir, 'journal.jsonl')),
    readClaudeWorkflowRecord(
      join(dirname(subagentTranscriptsDirFor(args.parentPath)), 'workflows', `${args.runId}.json`)
    )
  ])
  const listed = await listClaudeSubagentSessions({
    parentFilePath: args.parentPath,
    subagentsDir: runDir,
    statusByAgentId: journal.statusByAgentId
  })
  acc.addScanIssues(listed.issues)
  const children = oldestFirst(listed.sessions)
  const reported = notification?.status ?? record?.status ?? null
  const workflowId = claudeWorkflowNodeId(args.runId)
  const workflow = acc.addNode({
    id: workflowId,
    parentId: args.parentNodeId,
    role: 'workflow',
    agentType: 'workflow',
    label: launch?.workflowName ?? record?.workflowName ?? args.runId,
    model: record?.defaultModel ?? null,
    status:
      (reported ? RUN_STATUS[reported] : undefined) ??
      (children.some((child) => child.subagent?.status === 'running') ? 'running' : null),
    transcriptPath: null,
    startedAt: launch?.at ?? children[0]?.createdAt ?? null,
    updatedAt: notification?.at ?? children.at(-1)?.updatedAt ?? null,
    totalTokens: 0,
    messageCount: 0,
    depth: args.depth
  })
  if (!workflow) {
    return
  }
  acc.addEdge({
    from: args.parentNodeId,
    to: workflowId,
    kind: 'spawn',
    callId: launch?.toolUseId ?? undefined,
    text: launch?.summary ?? null,
    at: launch?.at ?? null
  })
  if (notification?.summary) {
    acc.addEdge({
      from: workflowId,
      to: args.parentNodeId,
      kind: 'result',
      callId: launch?.toolUseId ?? undefined,
      text: notification.summary,
      at: notification.at
    })
  }
  const added: AiVaultSession[] = []
  for (const session of children) {
    const agentId = claudeAgentIdFromPath(session.filePath)
    if (
      addWorkflowAgent(acc, {
        workflowId,
        depth: args.depth + 1,
        session,
        agent: journal.agents.get(agentId)
      })
    ) {
      workflow.totalTokens += session.totalTokens
      workflow.messageCount += session.messageCount
      added.push(session)
    }
  }
  for (const session of added) {
    await args.descend({
      parentNodeId: claudeAgentNodeId(claudeAgentIdFromPath(session.filePath)),
      parentPath: session.filePath,
      depth: args.depth + 2
    })
  }
}

function addWorkflowAgent(
  acc: AgentGraphAccumulator,
  args: {
    workflowId: string
    depth: number
    session: AiVaultSession
    agent: ClaudeWorkflowJournalAgent | undefined
  }
): boolean {
  const { session, agent } = args
  const nodeId = claudeAgentNodeId(claudeAgentIdFromPath(session.filePath))
  const fields = agentGraphNodeFieldsFromSession(session)
  const node = acc.addNode({
    ...fields,
    id: nodeId,
    parentId: args.workflowId,
    role: 'subagent',
    agentType: session.subagent?.agentType ?? null,
    label: agent?.label ?? fields.label,
    depth: args.depth
  })
  if (!node) {
    return false
  }
  acc.addEdge({
    from: args.workflowId,
    to: nodeId,
    kind: 'spawn',
    text: agent?.phase ? `${agent.phase}: ${node.label}` : null,
    at: session.createdAt
  })
  if (agent?.result) {
    acc.addEdge({
      from: nodeId,
      to: args.workflowId,
      kind: 'result',
      text: agent.result,
      at: session.updatedAt
    })
  }
  return true
}
