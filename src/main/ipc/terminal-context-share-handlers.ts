import { ipcMain } from 'electron'
import {
  CancelTerminalContextSummary,
  GenerateTerminalContextSummary
} from '../../shared/terminal-context-share/terminal-context-share-params'
import type { CommitMessageAgentEnvironmentResolvers } from '../text-generation/commit-message-agent-environment'
import {
  cancelTerminalContextSummaryRequest,
  generateTerminalContextSummaryRequest
} from '../text-generation/terminal-context-summary-requests'
import { addFanoutListener } from '../runtime/events/event-listener-fanout'

export function registerTerminalContextShareHandlers(
  commitMessageAgentEnv?: CommitMessageAgentEnvironmentResolvers
): void {
  // Any window may summarize (detached workbench windows included); each sender owns its request.
  ipcMain.handle('terminalContext:summarize', async (event, args: unknown) => {
    const request = GenerateTerminalContextSummary.parse(args)
    const owner = `window:${event.sender.id}`
    const cancel = (): void => cancelTerminalContextSummaryRequest(owner, request)
    const releaseDestroyed = addFanoutListener(event.sender, 'destroyed', cancel)
    try {
      return await generateTerminalContextSummaryRequest(
        () => commitMessageAgentEnv,
        owner,
        request
      )
    } finally {
      releaseDestroyed()
    }
  })
  ipcMain.handle('terminalContext:cancel', (event, args: unknown) => {
    cancelTerminalContextSummaryRequest(
      `window:${event.sender.id}`,
      CancelTerminalContextSummary.parse(args)
    )
  })
}
