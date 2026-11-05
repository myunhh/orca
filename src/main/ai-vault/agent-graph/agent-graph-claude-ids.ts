import { basename, extname, join } from 'node:path'
import type { AiVaultSession } from '../../../shared/ai-vault/contracts/ai-vault-types'
import {
  subagentTranscriptsDirFor,
  SUBAGENT_TRANSCRIPT_PREFIX
} from '../scanners/claude/session-scanner-subagent-transcripts'

export const AGENT_GRAPH_ROOT_NODE_ID = 'root'
// Claude Workflow runs nest their agents under <stem>/subagents/workflows/<runId>/.
export const CLAUDE_WORKFLOWS_DIR_NAME = 'workflows'

export function claudeAgentIdFromPath(path: string): string {
  return basename(path, extname(path)).slice(SUBAGENT_TRANSCRIPT_PREFIX.length)
}

export function claudeAgentNodeId(agentId: string): string {
  return `claude:${agentId}`
}

export function claudeWorkflowNodeId(runId: string): string {
  return `workflow:${runId}`
}

export function claudeWorkflowsDirFor(parentPath: string): string {
  return join(subagentTranscriptsDirFor(parentPath), CLAUDE_WORKFLOWS_DIR_NAME)
}

export function oldestFirst(sessions: readonly AiVaultSession[]): AiVaultSession[] {
  const time = (session: AiVaultSession): string => session.createdAt ?? session.modifiedAt
  return [...sessions].sort((left, right) => time(left).localeCompare(time(right)))
}

export type ClaudeDescend = (args: {
  parentNodeId: string
  parentPath: string
  depth: number
}) => Promise<void>
