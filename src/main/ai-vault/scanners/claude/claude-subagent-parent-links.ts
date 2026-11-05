import { createInterface } from 'node:readline'
import {
  CLAUDE_TASK_NOTIFICATION_MARKER,
  readClaudeTaskNotification
} from '../../../../shared/claude-task-notification-text'
import { openTranscriptReadStream } from '../../../native-chat/wsl-transcript-fs-access'
import { asRecord } from '../../session-scanner-record-value'
import { extractString, parseJsonObject } from '../../session-scanner-values'

const TOOL_USE_RESULT_MARKER = '"toolUseResult"'
// Require agentId to avoid decoding large ordinary tool outputs during the status pass.
const TOOL_USE_RESULT_AGENT_ID_MARKER = '"agentId"'
const WORKFLOW_LAUNCH_MARKER = '"local_workflow"'
const TOOL_USE_MARKER = '"tool_use"'
// Claude writes compact JSON, so tool names appear verbatim in spawn lines.
const SPAWN_TOOL_NAMES = new Set(['Agent', 'Task'])
const MESSAGE_TOOL_NAMES = new Set(['SendMessage'])
const LINK_TOOL_NAME_MARKERS = ['"name":"Agent"', '"name":"Task"', '"name":"SendMessage"']

export type ClaudeSpawnCall = {
  toolUseId: string
  description: string | null
  prompt: string | null
  subagentType: string | null
  model: string | null
  at: string | null
}

export type ClaudeTaskOutcome = {
  agentId: string
  toolUseId: string | null
  status: string | null
  agentType: string | null
  resolvedModel: string | null
  resultText: string | null
  at: string | null
}

export type ClaudeWorkflowLaunch = {
  runId: string
  taskId: string | null
  workflowName: string | null
  summary: string | null
  toolUseId: string | null
  at: string | null
}

export type ClaudeTaskNotification = {
  taskId: string
  toolUseId: string | null
  status: string | null
  summary: string | null
  at: string | null
}

export type ClaudeMessageCall = {
  toolUseId: string
  to: string
  text: string | null
  at: string | null
}

export type ClaudeSubagentParentLinks = {
  /** Last reported status per agentId / background task id. */
  statusByTaskId: Map<string, string>
  spawnsByToolUseId: Map<string, ClaudeSpawnCall>
  outcomesByAgentId: Map<string, ClaudeTaskOutcome>
  workflowsByRunId: Map<string, ClaudeWorkflowLaunch>
  notificationsByTaskId: Map<string, ClaudeTaskNotification>
  messages: ClaudeMessageCall[]
}

function emptyLinks(): ClaudeSubagentParentLinks {
  return {
    statusByTaskId: new Map(),
    spawnsByToolUseId: new Map(),
    outcomesByAgentId: new Map(),
    workflowsByRunId: new Map(),
    notificationsByTaskId: new Map(),
    messages: []
  }
}

/** Status-only callers skip spawn/workflow decoding so large ordinary lines stay unparsed. */
export async function collectClaudeSubagentParentLinks(
  parentFilePath: string,
  options: { detailed: boolean }
): Promise<ClaudeSubagentParentLinks> {
  const links = emptyLinks()
  const input = openTranscriptReadStream(parentFilePath, { encoding: 'utf-8' }, 'scan')
  const lines = createInterface({ input, crlfDelay: Infinity })
  try {
    for await (const line of lines) {
      consumeParentLine(links, line, options.detailed)
    }
  } catch {
    // A missing/unreadable parent transcript degrades to recency-only status.
  } finally {
    // readline.close() leaves its input open; destroy the gated stream even after read failures.
    lines.close()
    input.destroy()
  }
  return links
}

function consumeParentLine(links: ClaudeSubagentParentLinks, line: string, detailed: boolean) {
  const hasNotification = line.includes(CLAUDE_TASK_NOTIFICATION_MARKER)
  const hasTaskResult =
    line.includes(TOOL_USE_RESULT_MARKER) && line.includes(TOOL_USE_RESULT_AGENT_ID_MARKER)
  const hasWorkflowLaunch =
    detailed && line.includes(TOOL_USE_RESULT_MARKER) && line.includes(WORKFLOW_LAUNCH_MARKER)
  const hasLinkCall =
    detailed &&
    line.includes(TOOL_USE_MARKER) &&
    LINK_TOOL_NAME_MARKERS.some((marker) => line.includes(marker))
  if (!hasNotification && !hasTaskResult && !hasWorkflowLaunch && !hasLinkCall) {
    return
  }
  const record = parseJsonObject(line)
  if (!record) {
    return
  }
  const at = extractString(record.timestamp)
  if (hasLinkCall) {
    readLinkCalls(links, record, at)
  }
  // Quoted markers must fall through to toolUseResult; verbatim leading notifications lack provenance to distinguish them.
  if (hasNotification) {
    const text = taskNotificationText(record)
    if (text.startsWith(CLAUDE_TASK_NOTIFICATION_MARKER)) {
      const notification = readClaudeTaskNotification(text)
      if (notification) {
        if (notification.status) {
          links.statusByTaskId.set(notification.taskId, notification.status)
        }
        if (detailed) {
          links.notificationsByTaskId.set(notification.taskId, {
            taskId: notification.taskId,
            toolUseId: tagText(text, 'tool-use-id'),
            status: notification.status ?? null,
            summary: tagText(text, 'result') ?? tagText(text, 'summary'),
            at
          })
        }
      }
      return
    }
  }
  const result = asRecord(record.toolUseResult)
  if (hasWorkflowLaunch && result?.taskType === 'local_workflow') {
    const runId = extractString(result.runId)
    if (runId) {
      links.workflowsByRunId.set(runId, {
        runId,
        taskId: extractString(result.taskId),
        workflowName: extractString(result.workflowName),
        summary: extractString(result.summary),
        toolUseId: firstToolResultUseId(record),
        at
      })
    }
    return
  }
  const agentId = extractString(result?.agentId)
  const status = extractString(result?.status)
  if (agentId && status) {
    links.statusByTaskId.set(agentId, status)
  }
  if (detailed && agentId && result) {
    const prior = links.outcomesByAgentId.get(agentId)
    links.outcomesByAgentId.set(agentId, {
      agentId,
      toolUseId: firstToolResultUseId(record) ?? prior?.toolUseId ?? null,
      status: status ?? prior?.status ?? null,
      agentType: extractString(result.agentType) ?? prior?.agentType ?? null,
      resolvedModel: extractString(result.resolvedModel) ?? prior?.resolvedModel ?? null,
      // An async launch acknowledgement is not the child's answer.
      resultText:
        status === 'async_launched'
          ? (prior?.resultText ?? null)
          : (contentText(result.content) ?? toolResultText(record) ?? prior?.resultText ?? null),
      at
    })
  }
}

function readLinkCalls(
  links: ClaudeSubagentParentLinks,
  record: Record<string, unknown>,
  at: string | null
): void {
  const content = asRecord(record.message)?.content
  if (!Array.isArray(content)) {
    return
  }
  for (const value of content) {
    const block = asRecord(value)
    const id = extractString(block?.id)
    const name = extractString(block?.name)
    const input = asRecord(block?.input)
    if (block?.type !== 'tool_use' || !id || !name || !input) {
      continue
    }
    if (SPAWN_TOOL_NAMES.has(name)) {
      links.spawnsByToolUseId.set(id, {
        toolUseId: id,
        description: extractString(input.description),
        prompt: extractString(input.prompt),
        subagentType: extractString(input.subagent_type),
        model: extractString(input.model),
        at
      })
    } else if (MESSAGE_TOOL_NAMES.has(name)) {
      const to = extractString(input.to) ?? extractString(input.agentId)
      if (to) {
        links.messages.push({
          toolUseId: id,
          to,
          text: extractString(input.message) ?? extractString(input.content),
          at
        })
      }
    }
  }
}

function firstToolResultUseId(record: Record<string, unknown>): string | null {
  const content = asRecord(record.message)?.content
  if (!Array.isArray(content)) {
    return null
  }
  for (const value of content) {
    const block = asRecord(value)
    if (block?.type === 'tool_result') {
      return extractString(block.tool_use_id)
    }
  }
  return null
}

function toolResultText(record: Record<string, unknown>): string | null {
  const content = asRecord(record.message)?.content
  if (!Array.isArray(content)) {
    return null
  }
  for (const value of content) {
    const block = asRecord(value)
    if (block?.type === 'tool_result') {
      return contentText(block.content)
    }
  }
  return null
}

function contentText(content: unknown): string | null {
  if (typeof content === 'string') {
    return content.trim() || null
  }
  if (!Array.isArray(content)) {
    return null
  }
  const text = content.map(taskNotificationBlockText).filter(Boolean).join('\n').trim()
  return text || null
}

function tagText(text: string, tag: string): string | null {
  const start = text.indexOf(`<${tag}>`)
  if (start === -1) {
    return null
  }
  const from = start + tag.length + 2
  const end = text.indexOf(`</${tag}>`, from)
  return (end === -1 ? text.slice(from) : text.slice(from, end)).trim() || null
}

// Read full notification text: status can occur beyond title/preview truncation limits.
function taskNotificationText(record: Record<string, unknown>): string {
  const direct = extractString(record.content)
  if (direct) {
    return direct
  }
  const content = asRecord(record.message)?.content
  if (typeof content === 'string') {
    return content.trim()
  }
  if (Array.isArray(content)) {
    return content.map(taskNotificationBlockText).filter(Boolean).join(' ').trim()
  }
  return ''
}

function taskNotificationBlockText(block: unknown): string {
  if (typeof block === 'string') {
    return block
  }
  const record = asRecord(block)
  return extractString(record?.text) ?? extractString(record?.content) ?? ''
}
