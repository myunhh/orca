import type { Store } from '../persistence/loading-store/store'
import type { CommitMessageAgentEnvironmentResolvers } from '../text-generation/commit-message-agent-environment'
import { registerJiraIssueSummaryGenerationHandlers } from './jira/issue-summary-generation'
import { registerTerminalContextShareHandlers } from './terminal-context-share-handlers'

/** Non-source-control text generation that runs on this desktop's agent CLI. */
export function registerTextGenerationRequestHandlers(
  store: Pick<Store, 'getSettings'>,
  commitMessageAgentEnv?: CommitMessageAgentEnvironmentResolvers
): void {
  registerJiraIssueSummaryGenerationHandlers(store, commitMessageAgentEnv)
  registerTerminalContextShareHandlers(commitMessageAgentEnv)
}
