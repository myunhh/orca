import { ipcMain } from 'electron'
import {
  isAgentGraphProvider,
  type AgentGraphBuildArgs,
  type AgentGraphBuildResult,
  type AgentGraphNodeMessagesArgs,
  type AgentGraphNodeMessagesResult,
  type AgentGraphProvider
} from '../../../shared/agent-graph/agent-graph-types'
import type {
  AiVaultSubagentListArgs,
  AiVaultSubagentListResult
} from '../../../shared/ai-vault/contracts/ai-vault-types'
import { agentHookServer } from '../../agent-hooks/server/agent-hook-server'
import { readAgentGraphNodeMessages } from '../../ai-vault/agent-graph/agent-graph-node-messages'
import { errorMessage } from '../../ai-vault/session-scanner-values'
import {
  admitAgentGraphTranscript,
  inferAgentGraphProvider
} from './agent-graph-transcript-admission'
import { listAiVaultSubagentSessions } from './ai-vault-subagent-list'
import { buildAgentGraphForSender } from './agent-graph-build-requests'

const MAX_PANE_KEY_LENGTH = 256
const MAX_PATH_LENGTH = 4096

type PaneSessionCandidate = {
  provider: AgentGraphProvider | null
  agentType: string | null
  transcriptPath: string | null
  remote: boolean
}

/** Main's hook rows are authoritative for a live pane; the renderer hint covers sleeping panes. */
function paneSessionFromHooks(paneKey: string): PaneSessionCandidate | null {
  const row = agentHookServer
    .getStatusSnapshotForPane(paneKey)
    .find((candidate) => candidate.providerSession)
  const identity = agentHookServer
    .getProviderSessionIdentities()
    .find((candidate) => candidate.paneKey === paneKey)
  const transcriptPath = row?.providerSession?.transcriptPath ?? identity?.transcriptPath ?? null
  if (!row && !identity) {
    return null
  }
  const agentType = row?.agentType ?? null
  return {
    provider: isAgentGraphProvider(agentType) ? agentType : null,
    agentType,
    transcriptPath,
    // Remote ingest alone stamps a mux connection; those transcripts live on another host.
    remote: Boolean(row?.connectionId)
  }
}

export async function buildAgentGraphForPane(
  args: unknown,
  senderId: number
): Promise<AgentGraphBuildResult> {
  const request = readBuildArgs(args)
  if (!request) {
    return { ok: false, reason: 'no-session', message: 'Invalid agent graph request' }
  }
  const hooked = paneSessionFromHooks(request.paneKey)
  if (hooked?.remote) {
    return {
      ok: false,
      reason: 'remote-host',
      message: 'Agent graphs are not supported for remote hosts yet'
    }
  }
  if (hooked?.agentType && !hooked.provider) {
    return {
      ok: false,
      reason: 'unsupported-agent',
      message: `Agent graphs support Claude Code, Codex, and OMP sessions (this pane runs ${hooked.agentType})`
    }
  }
  const candidate = hooked?.transcriptPath
    ? { provider: hooked.provider, transcriptPath: hooked.transcriptPath }
    : (request.fallback ?? null)
  if (!candidate) {
    return {
      ok: false,
      reason: 'no-session',
      message: 'No agent session transcript has been reported for this pane yet'
    }
  }
  const admitted = candidate.provider
    ? await admitAgentGraphTranscript(candidate.provider, candidate.transcriptPath).then((path) =>
        path && candidate.provider ? { provider: candidate.provider, transcriptPath: path } : null
      )
    : await inferAgentGraphProvider(candidate.transcriptPath)
  if (!admitted) {
    return {
      ok: false,
      reason: 'not-admitted',
      message: 'The session transcript is outside the known local session folders'
    }
  }
  try {
    return { ok: true, graph: await buildAgentGraphForSender(senderId, admitted) }
  } catch (error) {
    return { ok: false, reason: 'unavailable', message: errorMessage(error) }
  }
}

export async function readAgentGraphNodeMessagesForRenderer(
  args: unknown
): Promise<AgentGraphNodeMessagesResult> {
  const request = readNodeMessagesArgs(args)
  if (!request) {
    return { ok: false, reason: 'invalid', message: 'Invalid message request' }
  }
  const transcriptPath = await admitAgentGraphTranscript(request.provider, request.transcriptPath)
  if (!transcriptPath) {
    return {
      ok: false,
      reason: 'not-admitted',
      message: 'The transcript is outside the known local session folders'
    }
  }
  try {
    return await readAgentGraphNodeMessages({ provider: request.provider, transcriptPath })
  } catch (error) {
    return { ok: false, reason: 'unavailable', message: errorMessage(error) }
  }
}

function readBuildArgs(args: unknown): AgentGraphBuildArgs | null {
  if (typeof args !== 'object' || args === null || !('paneKey' in args)) {
    return null
  }
  const paneKey = args.paneKey
  if (typeof paneKey !== 'string' || !paneKey || paneKey.length > MAX_PANE_KEY_LENGTH) {
    return null
  }
  const fallback = 'fallback' in args ? readNodeMessagesArgs(args.fallback) : null
  return { paneKey, ...(fallback ? { fallback } : {}) }
}

function readNodeMessagesArgs(args: unknown): AgentGraphNodeMessagesArgs | null {
  if (
    typeof args !== 'object' ||
    args === null ||
    !('provider' in args) ||
    !('transcriptPath' in args)
  ) {
    return null
  }
  const { provider, transcriptPath } = args
  if (
    !isAgentGraphProvider(provider) ||
    typeof transcriptPath !== 'string' ||
    transcriptPath.length > MAX_PATH_LENGTH
  ) {
    return null
  }
  return { provider, transcriptPath }
}

/** Subagent listing and the agent graph share the transcript-root admission rules. */
export function registerAiVaultSubagentHandlers(): void {
  ipcMain.handle(
    'aiVault:listSubagentSessions',
    (_event, args?: AiVaultSubagentListArgs): Promise<AiVaultSubagentListResult> =>
      listAiVaultSubagentSessions(args)
  )
  ipcMain.handle('agentGraph:build', (event, args: unknown) =>
    buildAgentGraphForPane(args, event.sender.id)
  )
  ipcMain.handle('agentGraph:readNodeMessages', (_event, args: unknown) =>
    readAgentGraphNodeMessagesForRenderer(args)
  )
}
