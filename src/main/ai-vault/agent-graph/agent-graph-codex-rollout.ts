import { createInterface } from 'node:readline'
import { readActivity } from '../../../shared/codex-subagent-transcript'
import { openTranscriptReadStream, wslGatedStat } from '../../native-chat/wsl-transcript-fs-access'
import {
  readCodexNonUserOrigin,
  type CodexNonUserOrigin
} from '../scanners/codex/session-scanner-codex-non-user-origin'
import { asRecord } from '../session-scanner-record-value'
import { normalizeCodexUsage } from '../session-scanner-token-values'
import { extractString, parseJsonObject } from '../session-scanner-values'

export type CodexRolloutActivity = {
  threadId: string
  kind: 'started' | 'interacted' | 'interrupted'
  agentPath: string | null
  at: string
  atMs: number
}

export type CodexRolloutSummary = {
  path: string
  threadId: string | null
  origin: CodexNonUserOrigin | null
  model: string | null
  totalTokens: number
  messageCount: number
  firstUserText: string | null
  lastAgentText: string | null
  startedAt: string | null
  updatedAt: string | null
  mtimeMs: number
  /** Latest task_started/task_complete pair says the thread finished its last turn. */
  complete: boolean
  activities: CodexRolloutActivity[]
}

/** One streaming pass yields identity, usage, spawn activity, and the first/last exchanged text. */
export async function readCodexRolloutSummary(path: string): Promise<CodexRolloutSummary | null> {
  let mtimeMs: number
  try {
    mtimeMs = (await wslGatedStat(path, 'scan')).mtimeMs
  } catch {
    return null
  }
  const summary: CodexRolloutSummary = {
    path,
    threadId: null,
    origin: null,
    model: null,
    totalTokens: 0,
    messageCount: 0,
    firstUserText: null,
    lastAgentText: null,
    startedAt: null,
    updatedAt: null,
    mtimeMs,
    complete: false,
    activities: []
  }
  let sawSessionMeta = false
  const input = openTranscriptReadStream(path, { encoding: 'utf-8' }, 'scan')
  const lines = createInterface({ input, crlfDelay: Infinity })
  try {
    for await (const line of lines) {
      const record = parseJsonObject(line)
      if (!record) {
        continue
      }
      const timestamp = extractString(record.timestamp)
      summary.startedAt ??= timestamp
      summary.updatedAt = timestamp ?? summary.updatedAt
      const payload = asRecord(record.payload)
      // Forks copy parent metadata later; only the first session_meta defines this thread.
      if (record.type === 'session_meta' && payload && !sawSessionMeta) {
        sawSessionMeta = true
        summary.threadId = extractString(payload.id)
        summary.origin = readCodexNonUserOrigin(payload)
        continue
      }
      if (record.type === 'turn_context') {
        summary.model = extractString(payload?.model) ?? summary.model
        continue
      }
      if (record.type === 'event_msg' && payload) {
        consumeEventMessage(summary, record, payload, timestamp)
      }
    }
  } catch {
    // Partial reads still describe the thread as far as it was readable.
  } finally {
    lines.close()
    input.destroy()
  }
  return summary
}

function consumeEventMessage(
  summary: CodexRolloutSummary,
  record: Record<string, unknown>,
  payload: Record<string, unknown>,
  timestamp: string | null
): void {
  switch (payload.type) {
    case 'user_message': {
      summary.messageCount += 1
      summary.firstUserText ??= extractString(payload.message)
      return
    }
    case 'agent_message': {
      summary.messageCount += 1
      summary.lastAgentText = extractString(payload.message) ?? summary.lastAgentText
      return
    }
    case 'task_started': {
      summary.complete = false
      return
    }
    case 'task_complete': {
      summary.complete = true
      summary.lastAgentText = extractString(payload.last_agent_message) ?? summary.lastAgentText
      return
    }
    case 'token_count': {
      const total = normalizeCodexUsage(asRecord(payload.info)?.total_token_usage)
      if (total) {
        summary.totalTokens = total.totalTokens
      }
      return
    }
    case 'sub_agent_activity': {
      const activity = readActivity(record)
      if (activity) {
        summary.activities.push({
          threadId: activity.id,
          kind: activity.kind,
          agentPath: activity.description ?? null,
          atMs: activity.startedAt,
          at: timestamp ?? new Date(activity.startedAt).toISOString()
        })
      }
      break
    }
    default:
      break
  }
}
