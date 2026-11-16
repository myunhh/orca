import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import type { SshTarget } from '../../shared/ssh-types'
import { getActiveMultiplexer } from '../ssh/targets/ssh-target-registry'
import type {
  ExternalAutomationManager,
  ExternalAutomationProvider
} from '../../shared/automations/external/external-automation'
import { mapOpenClawJobs } from './external-job-mappers'
import { isExternalAutomationCommandOnPath } from './external-manager-local-command'

const OPENCLAW_JOBS_FILE = join(homedir(), '.openclaw', 'cron', 'jobs.json')
const PROVIDER_LABELS: Record<ExternalAutomationProvider, string> = {
  openclaw: 'OpenClaw'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readLocalOpenClawJobs(): Promise<unknown[]> {
  if (!existsSync(OPENCLAW_JOBS_FILE)) {
    return []
  }
  const content = await readFile(OPENCLAW_JOBS_FILE, 'utf-8')
  const parsed = JSON.parse(content) as unknown
  return isRecord(parsed) && Array.isArray(parsed.jobs) ? parsed.jobs : []
}

export async function listLocalManager(
  provider: ExternalAutomationProvider
): Promise<ExternalAutomationManager | null> {
  const [availableResult, jobsResult] = await Promise.allSettled([
    isExternalAutomationCommandOnPath(provider),
    readLocalOpenClawJobs()
  ])
  const available = availableResult.status === 'fulfilled' && availableResult.value
  const jobs = jobsResult.status === 'fulfilled' ? jobsResult.value : []
  const readError = jobsResult.status === 'rejected' ? String(jobsResult.reason) : null
  if (!available && jobs.length === 0 && !readError) {
    return null
  }
  const managerId = `${provider}:local`
  const providerLabel = PROVIDER_LABELS[provider]
  return {
    id: managerId,
    provider,
    label: `${providerLabel} on this computer`,
    targetLabel: 'this computer',
    target: { type: 'local' },
    status: readError ? 'unavailable' : 'available',
    error:
      readError ??
      (available
        ? null
        : `${providerLabel} jobs were found, but the ${provider} CLI is not on PATH.`),
    canManage: !readError && available,
    jobs: mapOpenClawJobs(managerId, jobs)
  }
}

const RemoteManagerResult = z.object({
  jobs: z.array(z.unknown()),
  openclawAvailable: z.boolean(),
  error: z.string().nullable()
})

export async function listRemoteManager(
  target: SshTarget,
  provider: ExternalAutomationProvider
): Promise<ExternalAutomationManager> {
  const label = PROVIDER_LABELS[provider]
  const manager: ExternalAutomationManager = {
    id: `${provider}:ssh:${target.id}`,
    provider,
    label: `${label} on ${target.label}`,
    targetLabel: target.label,
    target: { type: 'ssh', connectionId: target.id },
    status: 'unavailable',
    error: 'SSH target is not connected.',
    canManage: false,
    jobs: []
  }
  try {
    const mux = getActiveMultiplexer(target.id)
    if (!mux || mux.isDisposed()) {
      return manager
    }
    const result = RemoteManagerResult.parse(
      await mux.request('externalAutomations.list', { provider })
    )
    return {
      ...manager,
      status: result.error ? 'unavailable' : 'available',
      error:
        result.error ??
        (result.openclawAvailable ? null : `${label} CLI is not on the remote PATH.`),
      canManage: !result.error && result.openclawAvailable,
      jobs: mapOpenClawJobs(manager.id, result.jobs)
    }
  } catch (error) {
    return { ...manager, error: error instanceof Error ? error.message : String(error) }
  }
}
