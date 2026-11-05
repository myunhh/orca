import os from 'node:os'
import {
  findTerminalContextSummaryModelChoice,
  type TerminalContextSummaryCancellation,
  type TerminalContextSummaryRequest,
  type TerminalContextSummaryResult
} from '../../shared/terminal-context-share/terminal-context-share-types'
import { textGenerationFailure } from '../../shared/text-generation-failure-copy'
import {
  prepareLocalCommitMessageAgentEnv,
  type CommitMessageAgentEnvironmentResolvers
} from './commit-message-agent-environment'
import {
  cancelTerminalContextSummaryLocal,
  generateTerminalContextSummary
} from './terminal-context-summary-generation'

type ActiveRequest = { owner: string; requestId: string }
// One local lane per operation and cwd, so a single summary runs at a time.
let activeRequest: ActiveRequest | undefined
const cwd = os.homedir()

const CANCELED: TerminalContextSummaryResult = {
  success: false,
  error: 'Generation canceled.',
  canceled: true
}

export function cancelTerminalContextSummaryRequest(
  owner: string,
  args: TerminalContextSummaryCancellation
): void {
  if (activeRequest?.owner === owner && activeRequest.requestId === args.requestId) {
    activeRequest = undefined
    cancelTerminalContextSummaryLocal(cwd)
  }
}

/** Summaries always run on this desktop's CLI: the text is already read, so remote hosts need no agent. */
export async function generateTerminalContextSummaryRequest(
  getAgentEnvironment: () => CommitMessageAgentEnvironmentResolvers | undefined,
  owner: string,
  args: TerminalContextSummaryRequest
): Promise<TerminalContextSummaryResult> {
  if (!args.text.trim()) {
    return { success: false, ...textGenerationFailure('terminalContextEmpty') }
  }
  const choice = findTerminalContextSummaryModelChoice(args.agentId, args.model)
  if (!choice) {
    return {
      success: false,
      ...textGenerationFailure('planModelUnavailable', { model: args.model, label: args.agentId })
    }
  }
  if (activeRequest) {
    if (activeRequest.owner !== owner) {
      return { success: false, ...textGenerationFailure('terminalContextSummaryBusy') }
    }
    cancelTerminalContextSummaryRequest(owner, activeRequest)
  }
  const request = { owner, requestId: args.requestId }
  activeRequest = request
  try {
    const localEnv = await prepareLocalCommitMessageAgentEnv(choice.agentId, getAgentEnvironment())
    if (activeRequest !== request) {
      return CANCELED
    }
    if (!localEnv.ok) {
      return { success: false, error: localEnv.error }
    }
    const result = await generateTerminalContextSummary(
      {
        sourceTitle: args.sourceTitle,
        sourceAgent: args.sourceAgent,
        text: args.text,
        instruction: args.instruction
      },
      { agentId: choice.agentId, model: choice.model },
      { kind: 'local', cwd, ...(localEnv.env ? { env: localEnv.env } : {}) }
    )
    return activeRequest === request ? result : CANCELED
  } finally {
    if (activeRequest === request) {
      activeRequest = undefined
    }
  }
}
