import { basename, relative } from 'node:path'
import type { AiVaultSession } from '../../../shared/ai-vault/contracts/ai-vault-types'
import { wslGatedStat } from '../../native-chat/wsl-transcript-fs-access'
import { sessionIdFromFileName } from '../session-scanner-accumulator'
import { parseMessageGraphSessionFile } from '../scanners/session-scanner-graph-parsers'
import { listOmpSubagentSessions } from '../scanners/omp/session-scanner-omp-subagent-listing'
import {
  agentGraphNodeFieldsFromSession,
  lastAssistantPreview,
  type AgentGraphAccumulator
} from './agent-graph-accumulator'
import { AGENT_GRAPH_ROOT_NODE_ID, oldestFirst } from './agent-graph-claude-ids'
import { AgentGraphFileMemo, agentGraphFileStamp } from './agent-graph-file-memo'

const ompSessions = new AgentGraphFileMemo<AiVaultSession | null>()

/** OMP links children only by artifact-directory membership; prompts come from message details. */
export async function buildOmpAgentGraph(
  acc: AgentGraphAccumulator,
  rootPath: string
): Promise<string> {
  const root = await parseOmpTranscript(rootPath)
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
  await addOmpChildren(acc, {
    rootPath,
    parentNodeId: AGENT_GRAPH_ROOT_NODE_ID,
    parentPath: rootPath,
    depth: 1
  })
  return root?.sessionId ?? sessionIdFromFileName(rootPath)
}

async function parseOmpTranscript(path: string): Promise<AiVaultSession | null> {
  try {
    const fileStat = await wslGatedStat(path, 'scan')
    return await ompSessions.read(path, agentGraphFileStamp(fileStat), () =>
      parseMessageGraphSessionFile('omp', {
        path,
        mtimeMs: fileStat.mtimeMs,
        modifiedAt: fileStat.mtime.toISOString()
      })
    )
  } catch {
    return null
  }
}

async function addOmpChildren(
  acc: AgentGraphAccumulator,
  args: { rootPath: string; parentNodeId: string; parentPath: string; depth: number }
): Promise<void> {
  if (!acc.canDescend(args.depth)) {
    return
  }
  const listed = await listOmpSubagentSessions({ parentFilePath: args.parentPath })
  acc.addScanIssues(listed.issues)
  const added: { nodeId: string; path: string }[] = []
  for (const session of oldestFirst(listed.sessions)) {
    // Labels repeat across nesting levels, so the path relative to the root names the node.
    const nodeId = `omp:${relative(args.rootPath, session.filePath)}`
    const node = acc.addNode({
      ...agentGraphNodeFieldsFromSession(session),
      id: nodeId,
      parentId: args.parentNodeId,
      role: 'subagent',
      agentType: session.subagent?.agentType ?? null,
      depth: args.depth
    })
    if (!node) {
      continue
    }
    acc.addEdge({
      from: args.parentNodeId,
      to: nodeId,
      kind: 'spawn',
      at: session.createdAt
    })
    const result = lastAssistantPreview(session)
    if (result) {
      acc.addEdge({
        from: nodeId,
        to: args.parentNodeId,
        kind: 'result',
        text: result,
        at: session.updatedAt
      })
    }
    added.push({ nodeId, path: session.filePath })
  }
  for (const child of added) {
    await addOmpChildren(acc, {
      rootPath: args.rootPath,
      parentNodeId: child.nodeId,
      parentPath: child.path,
      depth: args.depth + 1
    })
  }
}
