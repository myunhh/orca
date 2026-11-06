import { basename, dirname, join } from 'node:path'
import { childDayDirectory } from '../../../shared/codex-subagent-transcript'
import type { AiVaultSubagentRunStatus } from '../../../shared/ai-vault/contracts/ai-vault-types'
import { wslGatedReaddir } from '../../native-chat/wsl-transcript-fs-access'
import { sessionIdFromFileName } from '../session-scanner-accumulator'
import type { AgentGraphAccumulator } from './agent-graph-accumulator'
import { AGENT_GRAPH_ROOT_NODE_ID } from './agent-graph-claude-ids'
import { codexCallsForThread, codexCollabPromptText } from './agent-graph-codex-calls'
import {
  codexThreadIdFromRolloutPath,
  discoverCodexChildrenByParent
} from './agent-graph-codex-discovery'
import type { CodexSubagentParentage } from '../scanners/codex/session-scanner-codex-non-user-origin'
import {
  readCodexRolloutSummary,
  type CodexCollabCall,
  type CodexRolloutActivity,
  type CodexRolloutSummary
} from './agent-graph-codex-rollout'

// Matches the Claude listing: without a terminal report, only recent writes imply running.
const RUNNING_RECENCY_MS = 5 * 60_000

export async function buildCodexAgentGraph(
  acc: AgentGraphAccumulator,
  rootPath: string
): Promise<string> {
  const root = await readCodexRolloutSummary(rootPath)
  acc.addNode({
    id: AGENT_GRAPH_ROOT_NODE_ID,
    parentId: null,
    role: 'root',
    agentType: null,
    label: root?.firstUserText?.split('\n')[0]?.slice(0, 120) ?? basename(rootPath),
    model: root?.model ?? null,
    status: null,
    transcriptPath: rootPath,
    startedAt: root?.startedAt ?? null,
    updatedAt: root?.updatedAt ?? null,
    totalTokens: root?.totalTokens ?? 0,
    messageCount: root?.messageCount ?? 0,
    depth: 0
  })
  if (root) {
    await addCodexChildren(acc, {
      parentNodeId: AGENT_GRAPH_ROOT_NODE_ID,
      parent: root,
      depth: 1,
      directoryCache: new Map()
    })
  } else {
    acc.addIssue(`Could not read ${basename(rootPath)}`)
  }
  return root?.threadId ?? sessionIdFromFileName(rootPath)
}

export function codexThreadNodeId(threadId: string): string {
  return `codex:${threadId}`
}

async function addCodexChildren(
  acc: AgentGraphAccumulator,
  args: {
    parentNodeId: string
    parent: CodexRolloutSummary
    depth: number
    directoryCache: Map<string, string[]>
  }
): Promise<void> {
  if (!acc.canDescend(args.depth)) {
    return
  }
  const byThread = new Map<string, CodexRolloutActivity[]>()
  for (const activity of args.parent.activities) {
    const list = byThread.get(activity.threadId) ?? []
    list.push(activity)
    byThread.set(activity.threadId, list)
  }
  // Spawn events are not always recorded in the parent rollout; the children's own metadata is.
  const knownPaths = new Map<string, string>()
  const parentThreadId = args.parent.threadId ?? codexThreadIdFromRolloutPath(args.parent.path)
  if (parentThreadId) {
    const discovered = await discoverCodexChildrenByParent({
      parentPath: args.parent.path,
      parentThreadId,
      directoryCache: args.directoryCache,
      checkCancelled: () => void acc.canDescend(args.depth)
    })
    for (const { threadId, path } of discovered) {
      knownPaths.set(threadId, path)
      if (!byThread.has(threadId)) {
        byThread.set(threadId, [])
      }
    }
  }
  const added: { threadId: string; child: CodexRolloutSummary }[] = []
  for (const [threadId, activities] of byThread) {
    const first = activities[0]
    const childPath =
      knownPaths.get(threadId) ??
      (first
        ? await resolveCodexChildPath(args.parent.path, threadId, first.atMs, args.directoryCache)
        : null)
    const child = childPath ? await readCodexRolloutSummary(childPath) : null
    // Forked rollouts copy parent metadata; trust only a child whose own first meta names this parent.
    const declaredParentId = child?.origin?.parentage?.parentThreadId
    if (child && declaredParentId && parentThreadId && declaredParentId !== parentThreadId) {
      acc.addIssue(`Codex thread ${threadId} names a different parent; left out of the graph`)
      continue
    }
    if (
      addCodexThreadNode(acc, {
        ...args,
        threadId,
        activities,
        child,
        parentCalls: args.parent.collabCalls
      })
    ) {
      if (child) {
        added.push({ threadId, child })
      }
    }
  }
  for (const { threadId, child } of added) {
    await addCodexChildren(acc, {
      parentNodeId: codexThreadNodeId(threadId),
      parent: child,
      depth: args.depth + 1,
      directoryCache: args.directoryCache
    })
  }
}

function addCodexThreadNode(
  acc: AgentGraphAccumulator,
  args: {
    parentNodeId: string
    depth: number
    threadId: string
    activities: CodexRolloutActivity[]
    child: CodexRolloutSummary | null
    parentCalls: readonly CodexCollabCall[]
  }
): boolean {
  const { child, activities } = args
  const parentage = child?.origin?.parentage
  const nodeId = codexThreadNodeId(args.threadId)
  const first = activities[0]
  const node = acc.addNode({
    id: nodeId,
    parentId: args.parentNodeId,
    role: 'subagent',
    agentType: parentage?.agentRole ?? null,
    label: codexThreadLabel(parentage, first?.agentPath, args.threadId),
    model: child?.model ?? null,
    status: codexThreadStatus(child, activities),
    transcriptPath: child?.path ?? null,
    startedAt: child?.startedAt ?? first?.at ?? null,
    updatedAt: child?.updatedAt ?? activities.at(-1)?.at ?? null,
    totalTokens: child?.totalTokens ?? 0,
    messageCount: child?.messageCount ?? 0,
    depth: args.depth
  })
  if (!node) {
    return false
  }
  if (!child) {
    acc.addIssue(`Transcript for Codex thread ${args.threadId} was not found`)
  }
  const { spawn, followUps } = codexCallsForThread(args.parentCalls, {
    threadId: args.threadId,
    origin: child?.origin
  })
  const spawnText =
    (spawn ? codexCollabPromptText(spawn.arguments) : null) ??
    child?.firstUserText ??
    child?.firstUserTextFallback ??
    null
  const base = { from: args.parentNodeId, to: nodeId }
  if (!activities.some((activity) => activity.kind === 'started')) {
    acc.addEdge({
      ...base,
      kind: 'spawn',
      callId: spawn?.callId,
      text: spawnText,
      at: spawn?.at ?? child?.startedAt ?? null
    })
  }
  for (const activity of activities) {
    acc.addEdge({
      ...base,
      kind: activity.kind === 'started' ? 'spawn' : 'message',
      callId: activity.kind === 'started' ? spawn?.callId : undefined,
      text:
        activity.kind === 'started'
          ? spawnText
          : activity.kind === 'interrupted'
            ? 'interrupted'
            : null,
      at: activity.at
    })
  }
  for (const call of followUps) {
    acc.addEdge({
      ...base,
      kind: 'message',
      callId: call.callId,
      text: codexCollabPromptText(call.arguments),
      at: call.at
    })
  }
  const resultText = child?.lastAgentText ?? child?.lastAgentTextFallback
  if (child?.complete && resultText) {
    acc.addEdge({
      from: nodeId,
      to: args.parentNodeId,
      kind: 'result',
      text: resultText,
      at: child.updatedAt
    })
  }
  return true
}

function codexThreadLabel(
  parentage: CodexSubagentParentage | null | undefined,
  activityPath: string | undefined | null,
  threadId: string
): string {
  const path = parentage?.agentPath ?? activityPath ?? null
  const tail = path ? (path.split('/').findLast((part) => part !== '') ?? null) : null
  if (parentage?.agentNickname && tail) {
    return `${parentage.agentNickname} · ${tail}`
  }
  return parentage?.agentNickname ?? path ?? threadId
}

function codexThreadStatus(
  child: CodexRolloutSummary | null,
  activities: CodexRolloutActivity[]
): AiVaultSubagentRunStatus | null {
  if (activities.at(-1)?.kind === 'interrupted') {
    return 'stopped'
  }
  if (child?.complete) {
    return 'completed'
  }
  return child && Date.now() - child.mtimeMs <= RUNNING_RECENCY_MS ? 'running' : null
}

/** Children share the parent's day directory unless they started after local midnight. */
async function resolveCodexChildPath(
  parentPath: string,
  threadId: string,
  startedAt: number,
  directoryCache: Map<string, string[]>
): Promise<string | null> {
  const suffix = `-${threadId}.jsonl`
  const parentDir = dirname(parentPath)
  const childDir = childDayDirectory(parentPath, startedAt)
  const directories = childDir && childDir !== parentDir ? [parentDir, childDir] : [parentDir]
  for (const directory of directories) {
    let names = directoryCache.get(directory)
    if (!names) {
      try {
        names = (await wslGatedReaddir(directory, 'scan')).map((entry) => entry.name)
      } catch {
        names = []
      }
      directoryCache.set(directory, names)
    }
    const name = names.find((entry) => entry.endsWith(suffix))
    if (name) {
      return join(directory, name)
    }
  }
  return null
}
