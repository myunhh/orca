import type { AiVaultSubagentRunStatus } from '../../../../shared/ai-vault/contracts/ai-vault-types'
import type {
  AgentGraphBuildResult,
  AgentGraphEdgeKind,
  AgentGraphMessage,
  AgentGraphNodeMessagesResult
} from '../../../../shared/agent-graph/agent-graph-types'
import type { Translate } from '@/i18n/use-translate'
import type { AgentDotState } from '../AgentStateDot'

export function agentGraphEdgeKindLabel(kind: AgentGraphEdgeKind, t: Translate): string {
  switch (kind) {
    case 'spawn':
      return t('components.agentGraph.copy.edgeSpawn', 'spawn')
    case 'message':
      return t('components.agentGraph.copy.edgeMessage', 'message')
    case 'result':
      return t('components.agentGraph.copy.edgeResult', 'result')
  }
}

export function agentGraphMessageRoleLabel(role: AgentGraphMessage['role'], t: Translate): string {
  switch (role) {
    case 'user':
      return t('components.agentGraph.copy.roleUser', 'Prompt')
    case 'assistant':
      return t('components.agentGraph.copy.roleAssistant', 'Reply')
    case 'tool':
      return t('components.agentGraph.copy.roleTool', 'Tool')
  }
}

/** Run statuses reuse the shared agent glyphs; unknown status draws no dot rather than guessing. */
export function agentGraphStatusDotState(
  status: AiVaultSubagentRunStatus | null
): AgentDotState | null {
  switch (status) {
    case 'running':
      return 'working'
    case 'completed':
      return 'done'
    case 'failed':
      return 'failed'
    case 'stopped':
      return 'interrupted'
    case null:
      return null
  }
}

export function agentGraphUnavailableCopy(
  result: Extract<AgentGraphBuildResult, { ok: false }>,
  t: Translate
): string {
  switch (result.reason) {
    case 'no-session':
      return t(
        'components.agentGraph.copy.noSession',
        'This pane has not reported an agent session transcript yet.'
      )
    case 'unsupported-agent':
      return t(
        'components.agentGraph.copy.unsupportedAgent',
        'Agent graphs support Claude Code, Codex, and OMP sessions.'
      )
    case 'remote-host':
      return t(
        'components.agentGraph.copy.remoteHost',
        'Agent graphs are not available for sessions on remote hosts yet.'
      )
    case 'not-admitted':
      return t(
        'components.agentGraph.copy.notAdmitted',
        'The session transcript is outside the known local session folders.'
      )
    case 'desktop-only':
      return t(
        'components.agentGraph.copy.desktopOnly',
        'Agent graphs are available in the desktop app.'
      )
    case 'unavailable':
      return t('components.agentGraph.copy.unavailable', 'Could not build the graph: {{detail}}', {
        detail: result.message
      })
  }
}

export function agentGraphNodeMessagesUnavailableCopy(
  result: Extract<AgentGraphNodeMessagesResult, { ok: false }>,
  t: Translate
): string {
  switch (result.reason) {
    case 'invalid':
      return t(
        'components.agentGraph.copy.transcriptInvalid',
        'This transcript request was not valid.'
      )
    case 'not-admitted':
      return t(
        'components.agentGraph.copy.transcriptNotAdmitted',
        'The transcript is outside the known local session folders.'
      )
    case 'desktop-only':
      return t(
        'components.agentGraph.copy.desktopOnly',
        'Agent graphs are available in the desktop app.'
      )
    case 'unavailable':
      return t(
        'components.agentGraph.copy.transcriptUnavailable',
        'Could not read the transcript: {{detail}}',
        { detail: result.message }
      )
  }
}

export function agentGraphIssuesSummary(count: number, t: Translate): string {
  return t('components.agentGraph.copy.issues', 'Some transcripts could not be read ({{count}}).', {
    count
  })
}
