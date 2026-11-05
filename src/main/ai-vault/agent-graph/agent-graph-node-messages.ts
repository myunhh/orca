import {
  AGENT_GRAPH_MESSAGE_LIMIT,
  AGENT_GRAPH_MESSAGE_TEXT_MAX,
  truncateAgentGraphText,
  type AgentGraphMessage,
  type AgentGraphNodeMessagesResult,
  type AgentGraphProvider
} from '../../../shared/agent-graph/agent-graph-types'
import type {
  NativeChatBlock,
  NativeChatMessage
} from '../../../shared/native-chat/native-chat-types'
import { createInterface } from 'node:readline'
import { readNativeChatTranscriptTail } from '../../native-chat/transcript-watch'
import { nativeChatLineDecoderForAgent } from '../../native-chat/transcript-tail-reader'
import { openTranscriptReadStream } from '../../native-chat/wsl-transcript-fs-access'
import { sessionIdFromFileName } from '../session-scanner-accumulator'

const TOOL_INPUT_PREVIEW_MAX = 600
// The opening prompt sits near the head; stop scanning once it is clearly absent.
const FIRST_PROMPT_SCAN_LINES = 400

/** Reads the newest transcript window through the Chat UI decoders and flattens it to plain text rows. */
export async function readAgentGraphNodeMessages(args: {
  provider: AgentGraphProvider
  /** Already admitted against the provider's session roots by the caller. */
  transcriptPath: string
}): Promise<AgentGraphNodeMessagesResult> {
  const result = await readNativeChatTranscriptTail({
    agent: args.provider,
    sessionId: sessionIdFromFileName(args.transcriptPath),
    filePath: args.transcriptPath,
    limit: AGENT_GRAPH_MESSAGE_LIMIT,
    sourceOrder: true
  })
  if ('error' in result) {
    return { ok: false, message: result.error }
  }
  const messages: AgentGraphMessage[] = []
  for (const message of result.messages) {
    const converted = toAgentGraphMessage(message)
    if (converted) {
      messages.push(converted)
    }
  }
  // A long transcript's tail drops the task the agent was given, so fetch it from the head.
  const openingPrompt = result.hasMore ? await readFirstUserMessage(args) : null
  return { ok: true, openingPrompt, messages, truncated: result.hasMore }
}

async function readFirstUserMessage(args: {
  provider: AgentGraphProvider
  transcriptPath: string
}): Promise<AgentGraphMessage | null> {
  const decode = nativeChatLineDecoderForAgent(args.provider)
  if (!decode) {
    return null
  }
  const input = openTranscriptReadStream(args.transcriptPath, { encoding: 'utf-8' }, 'scan')
  const lines = createInterface({ input, crlfDelay: Infinity })
  let index = 0
  try {
    for await (const line of lines) {
      index += 1
      if (index > FIRST_PROMPT_SCAN_LINES) {
        return null
      }
      const decoded = decode(line, `head-${index}`)
      const converted = decoded?.role === 'user' ? toAgentGraphMessage(decoded) : null
      if (converted?.role === 'user') {
        return converted
      }
    }
  } catch {
    // The tail already answered; a failed head read only loses the opening prompt.
  } finally {
    lines.close()
    input.destroy()
  }
  return null
}

function toAgentGraphMessage(message: NativeChatMessage): AgentGraphMessage | null {
  const role =
    message.role === 'user'
      ? 'user'
      : message.role === 'assistant'
        ? 'assistant'
        : message.role === 'tool'
          ? 'tool'
          : null
  if (!role) {
    return null
  }
  const text = truncateAgentGraphText(
    message.blocks.map(blockText).filter(Boolean).join('\n\n'),
    AGENT_GRAPH_MESSAGE_TEXT_MAX
  )
  if (!text) {
    return null
  }
  return {
    // Tool calls ride on assistant turns; surface them as tool rows when that is all they carry.
    role:
      role === 'assistant' && message.blocks.every((block) => block.type !== 'text')
        ? 'tool'
        : role,
    text,
    at: message.timestamp === null ? null : new Date(message.timestamp).toISOString(),
    ...(message.model ? { model: message.model } : {})
  }
}

function blockText(block: NativeChatBlock): string {
  switch (block.type) {
    case 'text':
      return block.text
    case 'tool-call':
      return `→ ${block.name} ${previewToolInput(block.input)}`.trim()
    case 'tool-result':
      return `← ${block.output}`
    default:
      return ''
  }
}

function previewToolInput(input: unknown): string {
  if (input === undefined || input === null) {
    return ''
  }
  let serialized: string
  try {
    serialized = typeof input === 'string' ? input : JSON.stringify(input)
  } catch {
    return ''
  }
  return serialized.length > TOOL_INPUT_PREVIEW_MAX
    ? `${serialized.slice(0, TOOL_INPUT_PREVIEW_MAX - 1)}…`
    : serialized
}
