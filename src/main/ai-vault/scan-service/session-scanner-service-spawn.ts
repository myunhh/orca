import { localAiVaultScanRoots } from '../ai-vault-scan-roots'
import type { SessionSearchHostScope } from '../../ai-vault-search/session-search-service'
import { fork, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import type {
  AiVaultSearchRequest,
  AiVaultSearchResponse,
  AiVaultSearchStatus
} from '../../../shared/ai-vault/search/ai-vault-search-types'
import type {
  AiVaultListResult,
  AiVaultSubagentListResult,
  AiVaultFirstUserPromptResult as ReadAiVaultFirstUserPromptResult
} from '../../../shared/ai-vault/contracts/ai-vault-types'
import type {
  AiVaultSessionTitleRequest,
  AiVaultSessionTitlesResult
} from '../../../shared/ai-vault/contracts/ai-vault-session-title'
import { withSpan } from '../../observability/tracer'
import type { ReadAiVaultFirstUserPromptArgs } from '../session-first-user-prompt-read'
import type { AgentGraph } from '../../../shared/agent-graph/agent-graph-types'
import type { AgentGraphBuildRequest } from '../agent-graph/agent-graph-builder'

import { sessionSearchServiceInit } from '../../ai-vault-search/session-search-service-init'
import { getSessionParseCachePersistenceOptions } from '../parse-cache/session-parse-cache-persistence'
import { buildAiVaultServiceEnv } from './session-scanner-service-env'
import { AiVaultScannerServiceClient } from './session-scanner-service-client'
import { getAiVaultServiceEntryPath } from './session-scanner-service-entry-path'
import { lowerAiVaultServicePriority } from './session-scanner-service-priority'
import type {
  AiVaultServiceResultValue,
  AiVaultServiceScanOptions,
  AiVaultServiceSubagentRequest,
  AiVaultSessionSearchInit
} from './session-scanner-service-protocol'
import {
  requestLocalAiVaultScan,
  type LocalAiVaultScanProgressHandle
} from '../ai-vault-local-scan-progress'

export function spawnAiVaultServiceProcess(): ChildProcess {
  const entryPath = getAiVaultServiceEntryPath()
  if (!existsSync(entryPath)) {
    throw new Error(`AI Vault service entry not found: ${entryPath}`)
  }
  const child = fork(entryPath, [], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    execArgv: ['--max-old-space-size=384'],
    env: buildAiVaultServiceEnv(),
    ...(process.platform === 'win32' ? { windowsHide: true } : {})
  })
  lowerAiVaultServicePriority(child.pid)
  child.unref()
  return child
}

let sharedClient: AiVaultScannerServiceClient | null = null
let idleTimeoutMs: number | undefined

/** Must run before the first request; the shared client reads it once. */
export function setAiVaultServiceIdleTimeoutMs(timeoutMs: number): void {
  idleTimeoutMs = timeoutMs
}

function getSharedClient(): AiVaultScannerServiceClient {
  sharedClient ??= new AiVaultScannerServiceClient({
    processFactory: spawnAiVaultServiceProcess,
    resolveSessionSearchRoots: localAiVaultScanRoots,
    init: () => ({
      sessionParseCache: getSessionParseCachePersistenceOptions(),
      sessionSearch: sessionSearchServiceInit()
    }),
    onStderr: (text) => console.error('[ai-vault-service]', text.trimEnd()),
    idleTimeoutMs
  })
  return sharedClient
}

export function scanAiVaultSessionsInService(
  options: AiVaultServiceScanOptions,
  signal?: AbortSignal,
  progress?: LocalAiVaultScanProgressHandle
): Promise<AiVaultListResult> {
  return withSpan('aiVault.scan.service', async (span) => {
    const value = await requestLocalAiVaultScan(
      (listener) =>
        getSharedClient().request<
          Extract<AiVaultServiceResultValue, { operation: 'scan' }>['value']
        >({ type: 'request', operation: 'scan', options }, signal, listener),
      { progress }
    )
    span.setAttribute('serviceDurationMs', value.durationMs)
    span.setAttribute('sessions', value.result.sessions.length)
    return value.result
  })
}

export function resolveAiVaultSessionTitlesInService(
  requests: AiVaultSessionTitleRequest[],
  signal?: AbortSignal
): Promise<AiVaultSessionTitlesResult> {
  return getSharedClient().request({ type: 'request', operation: 'titles', requests }, signal)
}

export function listAiVaultSubagentSessionsInService(
  request: AiVaultServiceSubagentRequest,
  signal?: AbortSignal
): Promise<AiVaultSubagentListResult> {
  return getSharedClient().request({ type: 'request', operation: 'subagents', request }, signal)
}

// Graph polling gets its own child so a slow build never retires the History child or trips its circuit.
let agentGraphClient: AiVaultScannerServiceClient | null = null
const AGENT_GRAPH_SERVICE_IDLE_TIMEOUT_MS = 60_000

function getAgentGraphClient(): AiVaultScannerServiceClient {
  agentGraphClient ??= new AiVaultScannerServiceClient({
    processFactory: spawnAiVaultServiceProcess,
    // No parse-cache persistence or search index: those files belong to the History child.
    init: () => ({ sessionParseCache: null, sessionSearch: null }),
    onStderr: (text) => console.error('[agent-graph-service]', text.trimEnd()),
    idleTimeoutMs: AGENT_GRAPH_SERVICE_IDLE_TIMEOUT_MS
  })
  return agentGraphClient
}

export function buildAgentGraphInService(
  request: AgentGraphBuildRequest,
  signal?: AbortSignal
): Promise<AgentGraph> {
  return getAgentGraphClient().request(
    { type: 'request', operation: 'agentGraph', request },
    signal
  )
}

export function readAiVaultFirstUserPromptInService(
  request: ReadAiVaultFirstUserPromptArgs,
  signal?: AbortSignal
): Promise<ReadAiVaultFirstUserPromptResult> {
  return getSharedClient().request({ type: 'request', operation: 'firstPrompt', request }, signal)
}

export function searchSessionsInService(
  request: AiVaultSearchRequest,
  hostScope?: SessionSearchHostScope
): Promise<AiVaultSearchResponse> {
  return getSharedClient().request({
    type: 'request',
    operation: 'searchSessions',
    request,
    ...(hostScope ? { hostScope } : {})
  })
}

export function sessionSearchStatusInService(): Promise<AiVaultSearchStatus> {
  return getSharedClient().request({
    type: 'request',
    operation: 'searchStatus'
  })
}

export function reconcileSessionSearchInService(): Promise<void> {
  return getSharedClient().request({
    type: 'request',
    operation: 'searchReconcile'
  })
}

export function clearSessionSearchInService(): Promise<void> {
  return getSharedClient().request({
    type: 'request',
    operation: 'searchClear'
  })
}

export function updateSessionSearchInService(init: AiVaultSessionSearchInit): void {
  getSharedClient().updateSessionSearch(init)
}

export function invalidateAiVaultServiceCache(paths: string[]): Promise<void> {
  return sharedClient?.invalidate(paths) ?? Promise.resolve()
}

export function clearAiVaultServiceRestartCircuit(): void {
  sharedClient?.clearRestartCircuit()
}

export function resetAiVaultScannerServiceForTests(): void {
  sharedClient?.dispose()
  sharedClient = null
  agentGraphClient?.dispose()
  agentGraphClient = null
  idleTimeoutMs = undefined
}
