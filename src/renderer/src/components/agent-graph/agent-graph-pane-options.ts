import type { AgentStatusEntry } from '../../../../shared/agent-status/contracts/agent-status-types'
import {
  isAgentGraphProvider,
  type AgentGraphBuildArgs
} from '../../../../shared/agent-graph/agent-graph-types'
import { makePaneKey } from '../../../../shared/workspace-layout/stable-pane-id'

export type AgentGraphPaneOption = {
  paneKey: string
  label: string
  agentType: string | null
  updatedAt: number
  fallback: AgentGraphBuildArgs['fallback']
}

/** Panes whose agent reported a provider session; only those have a transcript to graph. */
export function agentGraphPaneOptions(
  statuses: Record<string, AgentStatusEntry | undefined>
): AgentGraphPaneOption[] {
  const options: AgentGraphPaneOption[] = []
  for (const entry of Object.values(statuses)) {
    if (!entry?.providerSession) {
      continue
    }
    const agentType = entry.agentType ?? null
    const transcriptPath = entry.providerSession.transcriptPath
    options.push({
      paneKey: entry.paneKey,
      label: entry.terminalTitle?.trim() || agentType || entry.paneKey,
      agentType,
      updatedAt: entry.updatedAt,
      fallback:
        transcriptPath && isAgentGraphProvider(agentType)
          ? { provider: agentType, transcriptPath }
          : undefined
    })
  }
  return options.sort((left, right) => right.updatedAt - left.updatedAt)
}

export function activeTerminalPaneKey(state: {
  activeTabId: string | null
  terminalLayoutsByTabId: Record<string, { activeLeafId?: string | null } | undefined>
}): string | null {
  const tabId = state.activeTabId
  const leafId = tabId ? state.terminalLayoutsByTabId[tabId]?.activeLeafId : null
  if (!tabId || !leafId) {
    return null
  }
  try {
    return makePaneKey(tabId, leafId)
  } catch {
    // Legacy numeric leaf ids have no stable pane key.
    return null
  }
}

/** The tab's agent pane to graph: its active leaf when that runs an agent, else any agent pane in it. */
export function tabAgentGraphPaneKey(
  state: {
    agentStatusByPaneKey: Record<string, AgentStatusEntry | undefined>
    terminalLayoutsByTabId: Record<string, { activeLeafId?: string | null } | undefined>
  },
  tabId: string
): string | null {
  const activePane = activeTerminalPaneKey({
    activeTabId: tabId,
    terminalLayoutsByTabId: state.terminalLayoutsByTabId
  })
  if (activePane && state.agentStatusByPaneKey[activePane]?.providerSession) {
    return activePane
  }
  const prefix = `${tabId}:`
  for (const entry of Object.values(state.agentStatusByPaneKey)) {
    if (entry?.providerSession && entry.paneKey.startsWith(prefix)) {
      return entry.paneKey
    }
  }
  return null
}

/** An explicit target wins; otherwise follow the active pane, then the most recent agent pane. */
export function resolveAgentGraphPaneKey(args: {
  targetPaneKey: string | null
  activePaneKey: string | null
  options: readonly AgentGraphPaneOption[]
}): string | null {
  if (args.targetPaneKey) {
    return args.targetPaneKey
  }
  if (args.activePaneKey && args.options.some((option) => option.paneKey === args.activePaneKey)) {
    return args.activePaneKey
  }
  return args.options[0]?.paneKey ?? null
}
