import type { Stats } from 'node:fs'
import { createInterface } from 'node:readline'
import { isCodexCollabToolRowName } from '../../../shared/codex-collab-agent-tools'
import { readActivity } from '../../../shared/codex-subagent-transcript'
import { openTranscriptReadStream, wslGatedStat } from '../../native-chat/wsl-transcript-fs-access'
import {
  readCodexNonUserOrigin,
  type CodexNonUserOrigin
} from '../scanners/codex/session-scanner-codex-non-user-origin'
import { asRecord } from '../session-scanner-record-value'
import { normalizeCodexUsage } from '../session-scanner-token-values'
import { extractString, parseJsonObject } from '../session-scanner-values'
import { AgentGraphFileMemo, agentGraphFileStamp } from './agent-graph-file-memo'

export type CodexRolloutActivity = {
  threadId: string
  kind: 'started' | 'interacted' | 'interrupted'
  agentPath: string | null
  at: string
  atMs: number
}

/** A spawn/follow-up/wait call the thread made; newer Codex builds record these instead of activity events. */
export type CodexCollabCall = {
  callId: string
  name: string
  arguments: string
  output: string | null
  at: string | null
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
  firstUserTextFallback: string | null
  lastAgentTextFallback: string | null
  startedAt: string | null
  updatedAt: string | null
  mtimeMs: number
  /** Latest task_/turn_ started/complete pair says the thread finished its last turn. */
  complete: boolean
  activities: CodexRolloutActivity[]
  collabCalls: CodexCollabCall[]
}

const MAX_COLLAB_CALLS = 200
const MAX_COLLAB_TEXT_CHARS = 8192

const rollouts = new AgentGraphFileMemo<CodexRolloutSummary>()

/** One streaming pass yields identity, usage, spawn activity, and the first/last exchanged text. */
export async function readCodexRolloutSummary(path: string): Promise<CodexRolloutSummary | null> {
  let fileStat: Stats
  try {
    fileStat = await wslGatedStat(path, 'scan')
  } catch {
    return null
  }
  return rollouts.read(path, agentGraphFileStamp(fileStat), () =>
    scanCodexRollout(path, fileStat.mtimeMs)
  )
}

async function scanCodexRollout(path: string, mtimeMs: number): Promise<CodexRolloutSummary> {
  const summary: CodexRolloutSummary = {
    path,
    threadId: null,
    origin: null,
    model: null,
    totalTokens: 0,
    messageCount: 0,
    firstUserText: null,
    lastAgentText: null,
    firstUserTextFallback: null,
    lastAgentTextFallback: null,
    startedAt: null,
    updatedAt: null,
    mtimeMs,
    complete: false,
    activities: [],
    collabCalls: []
  }
  const callsById = new Map<string, CodexCollabCall>()
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
      } else if (record.type === 'response_item' && payload) {
        consumeResponseItem(summary, callsById, payload, timestamp)
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
    // Newer Codex builds emit turn_* for the same lifecycle (see codex-turn-transcript).
    case 'task_started':
    case 'turn_started': {
      summary.complete = false
      return
    }
    case 'task_complete':
    case 'turn_complete': {
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

function clip(text: string): string {
  return text.length > MAX_COLLAB_TEXT_CHARS ? text.slice(0, MAX_COLLAB_TEXT_CHARS) : text
}

function stringifyPayloadValue(value: unknown): string | null {
  if (typeof value === 'string') {
    return clip(value)
  }
  return value === undefined || value === null ? null : clip(JSON.stringify(value))
}

function messageText(payload: Record<string, unknown>): string | null {
  const content = Array.isArray(payload.content) ? payload.content : []
  const parts = content.flatMap((part) => {
    const text = extractString(asRecord(part)?.text)
    return text ? [text] : []
  })
  return parts.length > 0 ? parts.join('\n') : null
}

/** Rollouts that omit user_message/agent_message events still carry the exchange as response items. */
function consumeResponseItem(
  summary: CodexRolloutSummary,
  callsById: Map<string, CodexCollabCall>,
  payload: Record<string, unknown>,
  timestamp: string | null
): void {
  switch (payload.type) {
    case 'message': {
      const text = messageText(payload)
      if (!text) {
        return
      }
      if (payload.role === 'assistant') {
        summary.lastAgentTextFallback = text
      } else if (payload.role === 'user' && !text.trimStart().startsWith('<')) {
        // Leading tag blocks are injected environment context, not the task.
        summary.firstUserTextFallback ??= text
      }
      return
    }
    case 'function_call': {
      const name = extractString(payload.name)
      const callId = extractString(payload.call_id)
      if (!name || !callId || !isCodexCollabToolRowName(name)) {
        return
      }
      if (summary.collabCalls.length >= MAX_COLLAB_CALLS) {
        return
      }
      const call = {
        callId,
        name,
        arguments: stringifyPayloadValue(payload.arguments) ?? '',
        output: null,
        at: timestamp
      }
      callsById.set(callId, call)
      summary.collabCalls.push(call)
      return
    }
    case 'function_call_output': {
      const callId = extractString(payload.call_id)
      const call = callId ? callsById.get(callId) : undefined
      if (call) {
        call.output = stringifyPayloadValue(payload.output)
      }
      break
    }
    default:
      break
  }
}
