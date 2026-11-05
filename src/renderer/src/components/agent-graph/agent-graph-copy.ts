import type { AiVaultSubagentRunStatus } from '../../../../shared/ai-vault/contracts/ai-vault-types'
import type {
  AgentGraphBuildResult,
  AgentGraphEdgeKind,
  AgentGraphMessage
} from '../../../../shared/agent-graph/agent-graph-types'
import { translate } from '@/i18n/i18n'
import type { AgentDotState } from '../AgentStateDot'

export function agentGraphEdgeKindLabel(kind: AgentGraphEdgeKind): string {
  switch (kind) {
    case 'spawn':
      return translate('components.agentGraph.copy.edgeSpawn', 'spawn')
    case 'message':
      return translate('components.agentGraph.copy.edgeMessage', 'message')
    case 'result':
      return translate('components.agentGraph.copy.edgeResult', 'result')
  }
}

export function agentGraphMessageRoleLabel(role: AgentGraphMessage['role']): string {
  switch (role) {
    case 'user':
      return translate('components.agentGraph.copy.roleUser', 'Prompt')
    case 'assistant':
      return translate('components.agentGraph.copy.roleAssistant', 'Reply')
    case 'tool':
      return translate('components.agentGraph.copy.roleTool', 'Tool')
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
    default:
      return null
  }
}

export function agentGraphUnavailableCopy(
  result: Extract<AgentGraphBuildResult, { ok: false }>
): string {
  switch (result.reason) {
    case 'no-session':
      return translate(
        'components.agentGraph.copy.noSession',
        'This pane has not reported an agent session transcript yet.'
      )
    case 'unsupported-agent':
      return translate(
        'components.agentGraph.copy.unsupportedAgent',
        'Agent graphs support Claude Code, Codex, and OMP sessions.'
      )
    case 'remote-host':
      return translate(
        'components.agentGraph.copy.remoteHost',
        'Agent graphs are not available for sessions on remote hosts yet.'
      )
    case 'not-admitted':
      return translate(
        'components.agentGraph.copy.notAdmitted',
        'The session transcript is outside the known local session folders.'
      )
    case 'desktop-only':
      return translate(
        'components.agentGraph.copy.desktopOnly',
        'Agent graphs are available in the desktop app.'
      )
    case 'unavailable':
      return translate(
        'components.agentGraph.copy.unavailable',
        'Could not build the graph: {{detail}}',
        {
          detail: result.message
        }
      )
  }
}
