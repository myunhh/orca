import type { TextGenerationFailureFields } from '../text-generation-failure-copy'

/** Stream tail lines read from the source terminal before summarizing. */
export const TERMINAL_CONTEXT_READ_LINE_LIMIT = 1500
/** Keeps the prompt well inside the shared 60 s generation timeout. */
export const TERMINAL_CONTEXT_MAX_CHARS = 60_000
export const TERMINAL_CONTEXT_INSTRUCTION_MAX_CHARS = 2000
export const TERMINAL_CONTEXT_TITLE_MAX_CHARS = 200

export type TerminalContextSummaryAgentId = 'claude' | 'codex'

export type TerminalContextSummaryModelChoice = {
  id: string
  agentId: TerminalContextSummaryAgentId
  model: string
  /** Product names; not localized. */
  displayName: string
}

// Small, fast models first; Haiku is the default.
export const TERMINAL_CONTEXT_SUMMARY_MODEL_CHOICES: readonly TerminalContextSummaryModelChoice[] =
  [
    { id: 'claude-haiku', agentId: 'claude', model: 'haiku', displayName: 'Claude Haiku' },
    { id: 'claude-sonnet', agentId: 'claude', model: 'sonnet', displayName: 'Claude Sonnet' },
    { id: 'codex-luna', agentId: 'codex', model: 'gpt-5.6-luna', displayName: 'GPT-5.6 Luna' },
    { id: 'codex-mini', agentId: 'codex', model: 'gpt-5.4-mini', displayName: 'GPT-5.4 Mini' }
  ]

export const DEFAULT_TERMINAL_CONTEXT_SUMMARY_MODEL_CHOICE_ID = 'claude-haiku'

export function findTerminalContextSummaryModelChoice(
  agentId: string,
  model: string
): TerminalContextSummaryModelChoice | null {
  return (
    TERMINAL_CONTEXT_SUMMARY_MODEL_CHOICES.find(
      (choice) => choice.agentId === agentId && choice.model === model
    ) ?? null
  )
}

export type TerminalContextSummaryContext = {
  sourceTitle: string
  sourceAgent?: string | null
  text: string
  instruction?: string
}

export type TerminalContextSummaryRequest = TerminalContextSummaryContext & {
  requestId: string
  agentId: TerminalContextSummaryAgentId
  model: string
}

export type TerminalContextSummaryCancellation = Pick<TerminalContextSummaryRequest, 'requestId'>

export type TerminalContextSummaryResult =
  | { success: true; summary: string; agentLabel?: string }
  | ({ success: false; canceled?: boolean } & TextGenerationFailureFields)
