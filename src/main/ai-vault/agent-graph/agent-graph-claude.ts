import { basename } from 'node:path'
import type { AiVaultSession } from '../../../shared/ai-vault/contracts/ai-vault-types'
import { wslGatedReaddir } from '../../native-chat/wsl-transcript-fs-access'
import { sessionIdFromFileName } from '../session-scanner-accumulator'
import type { ClaudeSubagentParentLinks } from '../scanners/claude/claude-subagent-parent-links'
import {
  listClaudeSubagentSessions,
  readSubagentMeta
} from '../scanners/claude/session-scanner-claude-subagents'
import { subagentTranscriptsDirFor } from '../scanners/claude/session-scanner-subagent-transcripts'
import {
  agentGraphNodeFieldsFromSession,
  lastAssistantPreview,
  type AgentGraphAccumulator
} from './agent-graph-accumulator'
import { addClaudeWorkflowNodes } from './agent-graph-claude-workflows'
import {
  parseClaudeTranscript,
  parseClaudeTranscriptCached,
  readClaudeParentLinks
} from './agent-graph-claude-reads'
import {
  AGENT_GRAPH_ROOT_NODE_ID,
  CLAUDE_WORKFLOWS_DIR_NAME,
  claudeAgentIdFromPath,
  claudeAgentNodeId,
  oldestFirst
} from './agent-graph-claude-ids'

export async function buildClaudeAgentGraph(
  acc: AgentGraphAccumulator,
  rootPath: string
): Promise<string> {
  const root = await parseClaudeTranscript(rootPath)
  acc.addNode({
    id: AGENT_GRAPH_ROOT_NODE_ID,
    parentId: null,
    role: 'root',
    agentType: null,
    depth: 0,
    ...(root
      ? agentGraphNodeFieldsFromSession(root)
      : {
          label: basename(rootPath),
          model: null,
          status: null,
          transcriptPath: rootPath,
          startedAt: null,
          updatedAt: null,
          totalTokens: 0,
          messageCount: 0
        })
  })
  await addClaudeChildNodes(acc, {
    parentNodeId: AGENT_GRAPH_ROOT_NODE_ID,
    parentPath: rootPath,
    depth: 1
  })
  return root?.sessionId ?? sessionIdFromFileName(rootPath)
}

/** Reads one transcript's spawn links and attaches its direct children, workflows, and their descendants. */
export async function addClaudeChildNodes(
  acc: AgentGraphAccumulator,
  args: { parentNodeId: string; parentPath: string; depth: number }
): Promise<void> {
  if (!acc.canDescend(args.depth)) {
    return
  }
  const entries = await readSubagentDirNames(args.parentPath)
  if (entries.length === 0) {
    return
  }
  const links = await readClaudeParentLinks(args.parentPath)
  const listed = await listClaudeSubagentSessions({
    parentFilePath: args.parentPath,
    statusByAgentId: links.statusByTaskId,
    parseTranscript: parseClaudeTranscriptCached
  })
  acc.addScanIssues(listed.issues)
  const added: AiVaultSession[] = []
  for (const session of oldestFirst(listed.sessions)) {
    if (await addClaudeSubagentNode(acc, { ...args, session, links })) {
      added.push(session)
    }
  }
  if (entries.includes(CLAUDE_WORKFLOWS_DIR_NAME)) {
    await addClaudeWorkflowNodes(acc, {
      ...args,
      links,
      descend: (next) => addClaudeChildNodes(acc, next)
    })
  }
  for (const session of added) {
    await addClaudeChildNodes(acc, {
      parentNodeId: claudeAgentNodeId(claudeAgentIdFromPath(session.filePath)),
      parentPath: session.filePath,
      depth: args.depth + 1
    })
  }
}

async function addClaudeSubagentNode(
  acc: AgentGraphAccumulator,
  args: {
    parentNodeId: string
    depth: number
    session: AiVaultSession
    links: ClaudeSubagentParentLinks
  }
): Promise<boolean> {
  const { session, links } = args
  const agentId = claudeAgentIdFromPath(session.filePath)
  const outcome = links.outcomesByAgentId.get(agentId)
  const meta = await readSubagentMeta(session.filePath)
  const toolUseId = outcome?.toolUseId ?? meta.toolUseId
  const spawn = toolUseId ? links.spawnsByToolUseId.get(toolUseId) : undefined
  const notification = links.notificationsByTaskId.get(agentId)
  const nodeId = claudeAgentNodeId(agentId)
  const fields = agentGraphNodeFieldsFromSession(session)
  const node = acc.addNode({
    ...fields,
    id: nodeId,
    parentId: args.parentNodeId,
    role: 'subagent',
    agentType: session.subagent?.agentType ?? outcome?.agentType ?? spawn?.subagentType ?? null,
    label: spawn?.description ?? fields.label,
    model: fields.model ?? outcome?.resolvedModel ?? spawn?.model ?? null,
    depth: args.depth
  })
  if (!node) {
    return false
  }
  acc.addEdge({
    from: args.parentNodeId,
    to: nodeId,
    kind: 'spawn',
    callId: toolUseId ?? undefined,
    text: spawn?.prompt ?? null,
    at: spawn?.at ?? session.createdAt
  })
  for (const message of links.messages) {
    if (message.to === agentId) {
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
    outcome?.resultText ??
    notification?.summary ??
    (session.subagent?.status === 'completed' ? lastAssistantPreview(session) : null)
  if (resultText) {
    acc.addEdge({
      from: nodeId,
      to: args.parentNodeId,
      kind: 'result',
      callId: toolUseId ?? undefined,
      text: resultText,
      at: notification?.at ?? outcome?.at ?? session.updatedAt
    })
  }
  return true
}

/** Missing dirs mean no children; skip the full parent read in that common case. */
async function readSubagentDirNames(parentPath: string): Promise<string[]> {
  try {
    const entries = await wslGatedReaddir(subagentTranscriptsDirFor(parentPath), 'scan')
    return entries.map((entry) => entry.name)
  } catch {
    return []
  }
}
