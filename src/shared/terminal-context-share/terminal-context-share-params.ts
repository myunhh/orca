import { z } from 'zod'
import {
  TERMINAL_CONTEXT_INSTRUCTION_MAX_CHARS,
  TERMINAL_CONTEXT_MAX_CHARS,
  TERMINAL_CONTEXT_TITLE_MAX_CHARS
} from './terminal-context-share-types'

export const CancelTerminalContextSummary = z.object({
  requestId: z.string().trim().min(1).max(128)
})

// Callers bound the text first; the slack covers the share header the renderer may keep.
export const GenerateTerminalContextSummary = CancelTerminalContextSummary.extend({
  sourceTitle: z.string().max(TERMINAL_CONTEXT_TITLE_MAX_CHARS),
  sourceAgent: z.string().max(64).nullable().optional(),
  text: z
    .string()
    .min(1)
    .max(TERMINAL_CONTEXT_MAX_CHARS + 4096),
  instruction: z.string().max(TERMINAL_CONTEXT_INSTRUCTION_MAX_CHARS).optional(),
  agentId: z.enum(['claude', 'codex']),
  model: z.string().trim().min(1).max(128)
})
