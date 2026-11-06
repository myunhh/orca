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

type TerminalLayouts = Record<string, { activeLeafId?: string | null } | undefined>

/** Any pane with a hook row graphs: transcript agents in full, the rest from live hook rows. */
export function isAgentGraphPaneEntry(entry: AgentStatusEntry | undefined): boolean {
  return Boolean(entry && (entry.agentType || entry.providerSession))
}

export function graphablePaneKey(
  statuses: Record<string, AgentStatusEntry | undefined>,
  paneKey: string
): string | null {
  return isAgentGraphPaneEntry(statuses[paneKey]) ? paneKey : null
}

export function agentGraphPaneOptions(
  statuses: Record<string, AgentStatusEntry | undefined>
): AgentGraphPaneOption[] {
  const options: AgentGraphPaneOption[] = []
  for (const entry of Object.values(statuses)) {
    if (!entry || !isAgentGraphPaneEntry(entry)) {
      continue
    }
    const agentType = entry.agentType ?? null
    const transcriptPath = entry.providerSession?.transcriptPath
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

function paneKeyForTabActiveLeaf(layouts: TerminalLayouts, tabId: string | null): string | null {
  const leafId = tabId ? layouts[tabId]?.activeLeafId : null
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

export function activeTerminalPaneKey(state: {
  activeTabId: string | null
  terminalLayoutsByTabId: TerminalLayouts
}): string | null {
  return paneKeyForTabActiveLeaf(state.terminalLayoutsByTabId, state.activeTabId)
}

/** The tab's agent pane to graph: its active leaf when that runs an agent, else any agent pane in it. */
export function tabAgentGraphPaneKey(
  state: {
    agentStatusByPaneKey: Record<string, AgentStatusEntry | undefined>
    terminalLayoutsByTabId: TerminalLayouts
  },
  tabId: string
): string | null {
  const activePane = paneKeyForTabActiveLeaf(state.terminalLayoutsByTabId, tabId)
  if (activePane && isAgentGraphPaneEntry(state.agentStatusByPaneKey[activePane])) {
    return activePane
  }
  const prefix = `${tabId}:`
  for (const entry of Object.values(state.agentStatusByPaneKey)) {
    if (entry?.paneKey.startsWith(prefix) && isAgentGraphPaneEntry(entry)) {
      return entry.paneKey
    }
  }
  return null
}

/** A live explicit target wins; otherwise follow the active pane, then the most recent agent pane. */
export function resolveAgentGraphPaneKey(args: {
  targetPaneKey: string | null
  activePaneKey: string | null
  options: readonly AgentGraphPaneOption[]
}): string | null {
  const isOption = (paneKey: string | null): paneKey is string =>
    paneKey !== null && args.options.some((option) => option.paneKey === paneKey)
  if (isOption(args.targetPaneKey)) {
    return args.targetPaneKey
  }
  if (isOption(args.activePaneKey)) {
    return args.activePaneKey
  }
  return args.options[0]?.paneKey ?? null
}
