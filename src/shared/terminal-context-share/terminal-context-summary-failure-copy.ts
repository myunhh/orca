// Orca's own sentences for terminal context summaries; part of TEXT_GENERATION_FAILURE_COPY.
export const TERMINAL_CONTEXT_SUMMARY_FAILURE_COPY = {
  terminalContextEmpty: 'No terminal output to summarize.',
  terminalContextSummaryEmpty: 'The generated summary was empty.',
  terminalContextSummaryBusy: 'Another terminal context summary is already running.'
} as const

export type TerminalContextSummaryFailureCode = keyof typeof TERMINAL_CONTEXT_SUMMARY_FAILURE_COPY
