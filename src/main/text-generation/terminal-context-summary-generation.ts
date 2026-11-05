import {
  buildTerminalContextSummaryPrompt,
  sanitizeTerminalContextSummary
} from '../../shared/terminal-context-share/terminal-context-summary-prompt'
import type {
  TerminalContextSummaryContext,
  TerminalContextSummaryResult
} from '../../shared/terminal-context-share/terminal-context-share-types'
import type { ResolvedSourceControlAiGenerationParams } from '../../shared/source-control/ai/source-control-ai-operation-resolution'
import {
  textGenerationFailure,
  textGenerationFailureCodeFields
} from '../../shared/text-generation-failure-copy'
import { spawnSourceControlAgent } from './source-control-agent-launch'
import { cancelLocalGeneration } from './source-control-generation-lanes'
import { runGenerationRequest } from './agent-generation-request'
import type {
  CommitMessageGenerationTarget,
  SpawnSourceControlAgent
} from './source-control-text-generation-types'

// Source-control templates and instructions do not apply to terminal hand-off summaries.
export async function generateTerminalContextSummary(
  context: TerminalContextSummaryContext,
  params: ResolvedSourceControlAiGenerationParams,
  target: CommitMessageGenerationTarget,
  spawnAgent: SpawnSourceControlAgent = spawnSourceControlAgent
): Promise<TerminalContextSummaryResult> {
  const result = await runGenerationRequest({
    params,
    prompt: buildTerminalContextSummaryPrompt(context),
    target,
    spawnAgent,
    operation: 'terminal-context-summary'
  })
  if (!result.success) {
    return {
      success: false,
      error: result.error,
      canceled: result.canceled,
      ...textGenerationFailureCodeFields(result)
    }
  }
  const summary = sanitizeTerminalContextSummary(result.rawOutput)
  return summary
    ? { success: true, summary, agentLabel: result.agentLabel }
    : { success: false, ...textGenerationFailure('terminalContextSummaryEmpty') }
}

export function cancelTerminalContextSummaryLocal(cwd: string): void {
  cancelLocalGeneration('terminal-context-summary', cwd)
}
