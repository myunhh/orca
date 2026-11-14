import type {
  AiVaultListResult,
  AiVaultSubagentListResult,
  AiVaultFirstUserPromptResult as ReadAiVaultFirstUserPromptResult
} from '../../../shared/ai-vault/contracts/ai-vault-types'
import type {
  AiVaultSessionTitleRequest,
  AiVaultSessionTitlesResult
} from '../../../shared/ai-vault/contracts/ai-vault-session-title'
import type { ReadAiVaultFirstUserPromptArgs } from '../session-first-user-prompt-read'
import type { AgentGraph } from '../../../shared/agent-graph/agent-graph-types'
import type { AgentGraphBuildRequest } from '../agent-graph/agent-graph-builder'

import {
  clearAiVaultServiceRestartCircuit,
  invalidateAiVaultServiceCache,
  buildAgentGraphInService,
  listAiVaultSubagentSessionsInService,
  readAiVaultFirstUserPromptInService,
  resetAiVaultScannerServiceForTests,
  resolveAiVaultSessionTitlesInService,
  scanAiVaultSessionsInService
} from './session-scanner-service-spawn'
import type {
  AiVaultServiceScanOptions,
  AiVaultServiceSubagentRequest
} from './session-scanner-service-protocol'
import { isWslUncPath } from '../../../shared/wsl-paths'
import { localAiVaultScanRoots } from '../ai-vault-scan-roots'
import type { LocalAiVaultScanProgressHandle } from '../ai-vault-local-scan-progress'

// Let forced refreshes retry after a local service circuit opens.
export function clearAiVaultBackgroundRestartCircuit(): void {
  clearAiVaultServiceRestartCircuit()
}

export function scanAiVaultSessionsInBackground(
  options: AiVaultServiceScanOptions,
  signal?: AbortSignal,
  progress?: LocalAiVaultScanProgressHandle
): Promise<AiVaultListResult> {
  return scanAiVaultSessionsInService(options, signal, progress)
}

export function resolveAiVaultSessionTitlesInBackground(
  requests: AiVaultSessionTitleRequest[],
  signal?: AbortSignal
): Promise<AiVaultSessionTitlesResult> {
  return resolveAiVaultSessionTitlesInService(requests, signal)
}

export function listAiVaultSubagentSessionsInBackground(
  request: AiVaultServiceSubagentRequest
): Promise<AiVaultSubagentListResult> {
  return listAiVaultSubagentSessionsInService(request)
}

export function buildAgentGraphInBackground(
  request: AgentGraphBuildRequest,
  signal?: AbortSignal
): Promise<AgentGraph> {
  return buildAgentGraphInService(request, signal)
}

export async function readAiVaultFirstUserPromptInBackground(
  request: ReadAiVaultFirstUserPromptArgs
): Promise<ReadAiVaultFirstUserPromptResult> {
  if (process.platform === 'win32' && isWslUncPath(request.filePath)) {
    const roots = await localAiVaultScanRoots()
    request = { ...request, wslOpenCodeReaders: roots.wslOpenCodeReaders ?? [] }
  }
  return readAiVaultFirstUserPromptInService(request)
}

export function invalidateAiVaultBackgroundCache(paths: string[]): Promise<void> {
  return invalidateAiVaultServiceCache(paths)
}

export function resetAiVaultScannerBackgroundForTests(): void {
  resetAiVaultScannerServiceForTests()
}
