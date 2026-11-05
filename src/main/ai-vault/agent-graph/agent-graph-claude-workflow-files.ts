import { createInterface } from 'node:readline'
import { truncateAgentGraphText } from '../../../shared/agent-graph/agent-graph-types'
import {
  openTranscriptReadStream,
  wslGatedReadFile,
  wslGatedStat
} from '../../native-chat/wsl-transcript-fs-access'
import { asRecord } from '../session-scanner-record-value'
import { extractString, parseJsonObject } from '../session-scanner-values'

// The run record embeds the script and full results; skip reading pathological sizes.
const WORKFLOW_RECORD_MAX_BYTES = 8 * 1024 * 1024

export type ClaudeWorkflowJournalAgent = {
  label: string | null
  phase: string | null
  result: string | null
}

export type ClaudeWorkflowJournal = {
  agents: Map<string, ClaudeWorkflowJournalAgent>
  /** Values use the Task status vocabulary so the shared status resolver applies. */
  statusByAgentId: Map<string, string>
}

export type ClaudeWorkflowRecord = {
  workflowName: string | null
  status: string | null
  defaultModel: string | null
}

/** journal.jsonl records `started` and `result` per agent; other terminal kinds map by name. */
export async function readClaudeWorkflowJournal(path: string): Promise<ClaudeWorkflowJournal> {
  const journal: ClaudeWorkflowJournal = { agents: new Map(), statusByAgentId: new Map() }
  const input = openTranscriptReadStream(path, { encoding: 'utf-8' }, 'scan')
  const lines = createInterface({ input, crlfDelay: Infinity })
  try {
    for await (const line of lines) {
      const record = parseJsonObject(line)
      const agentId = extractString(record?.agentId)
      const type = extractString(record?.type)
      if (!record || !agentId || !type) {
        continue
      }
      const prior = journal.agents.get(agentId)
      journal.agents.set(agentId, {
        label: extractString(record.label) ?? prior?.label ?? null,
        phase: extractString(record.phase) ?? prior?.phase ?? null,
        result: truncateAgentGraphText(extractString(record.result)) ?? prior?.result ?? null
      })
      const status = journalStatus(type)
      if (status) {
        journal.statusByAgentId.set(agentId, status)
      }
    }
  } catch {
    // An unreadable journal leaves agents with recency-only status.
  } finally {
    lines.close()
    input.destroy()
  }
  return journal
}

function journalStatus(type: string): string | null {
  const normalized = type.toLowerCase()
  if (normalized === 'result' || normalized === 'completed') {
    return 'completed'
  }
  if (normalized.includes('fail') || normalized.includes('error')) {
    return 'failed'
  }
  if (normalized.includes('kill') || normalized.includes('cancel') || normalized.includes('stop')) {
    return 'stopped'
  }
  return null
}

/** Finished runs leave <stem>/workflows/<runId>.json with the workflow's own name and outcome. */
export async function readClaudeWorkflowRecord(path: string): Promise<ClaudeWorkflowRecord | null> {
  try {
    const fileStat = await wslGatedStat(path, 'scan')
    if (fileStat.size > WORKFLOW_RECORD_MAX_BYTES) {
      return null
    }
    const record = asRecord(JSON.parse(await wslGatedReadFile(path, 'utf-8', 'scan')) as unknown)
    if (!record) {
      return null
    }
    return {
      workflowName: extractString(record.workflowName),
      status: extractString(record.status),
      defaultModel: extractString(record.defaultModel)
    }
  } catch {
    return null
  }
}
