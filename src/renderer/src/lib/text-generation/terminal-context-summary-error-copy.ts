import { translate } from '@/i18n/i18n'
import {
  TERMINAL_CONTEXT_SUMMARY_FAILURE_COPY as EN,
  type TerminalContextSummaryFailureCode
} from '../../../../shared/terminal-context-share/terminal-context-summary-failure-copy'

type CopyValues = Record<string, string | number>

// Merged into the text-generation copy table; textGenerationErrorText checks the slot values.
export const TERMINAL_CONTEXT_SUMMARY_ERROR_COPY: Record<
  TerminalContextSummaryFailureCode,
  (values: CopyValues) => string
> = {
  terminalContextEmpty: (values) =>
    translate(
      'sourceControl.textGeneration.errors.terminalContextEmpty',
      EN.terminalContextEmpty,
      values
    ),
  terminalContextSummaryEmpty: (values) =>
    translate(
      'sourceControl.textGeneration.errors.terminalContextSummaryEmpty',
      EN.terminalContextSummaryEmpty,
      values
    ),
  terminalContextSummaryBusy: (values) =>
    translate(
      'sourceControl.textGeneration.errors.terminalContextSummaryBusy',
      EN.terminalContextSummaryBusy,
      values
    )
}
