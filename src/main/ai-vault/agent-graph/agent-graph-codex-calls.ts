import { asRecord } from '../session-scanner-record-value'
import type { CodexNonUserOrigin } from '../scanners/codex/session-scanner-codex-non-user-origin'
import type { CodexCollabCall } from './agent-graph-codex-rollout'

const PROMPT_KEYS = ['message', 'prompt', 'task', 'input', 'instructions', 'text']
const SPAWN_CALL_NAME = 'spawn_agent'
const FOLLOW_UP_CALL_NAMES = new Set(['send_input', 'followup_task', 'send_message'])

/** The text a call sent to its helper: a known key, else the longest string argument. */
export function codexCollabPromptText(args: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(args)
  } catch {
    return args.trim() || null
  }
  if (typeof parsed === 'string') {
    return parsed.trim() || null
  }
  const record = asRecord(parsed)
  if (!record) {
    return null
  }
  for (const key of PROMPT_KEYS) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) {
      return value
    }
  }
  let longest: string | null = null
  for (const value of Object.values(record)) {
    if (typeof value === 'string' && value.length > (longest?.length ?? 0)) {
      longest = value
    }
  }
  return longest
}

function namesThread(call: CodexCollabCall, handles: readonly string[]): boolean {
  return handles.some(
    (handle) => call.arguments.includes(handle) || (call.output?.includes(handle) ?? false)
  )
}

/** Parent calls aimed at one child; the model-facing id, path and nickname may each appear in them. */
export function codexCallsForThread(
  calls: readonly CodexCollabCall[],
  thread: { threadId: string; origin: CodexNonUserOrigin | null | undefined }
): { spawn: CodexCollabCall | null; followUps: CodexCollabCall[] } {
  const parentage = thread.origin?.parentage
  const handles = [thread.threadId, parentage?.agentPath, parentage?.agentNickname].filter(
    (handle): handle is string => Boolean(handle)
  )
  const spawn =
    calls.find((call) => call.name === SPAWN_CALL_NAME && namesThread(call, handles)) ?? null
  const followUps = calls.filter(
    (call) => FOLLOW_UP_CALL_NAMES.has(call.name) && namesThread(call, handles)
  )
  return { spawn, followUps }
}
