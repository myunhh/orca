import type { AgentSubagentSnapshot } from '../../../shared/agent-status/contracts/agent-status-subagent-snapshot'
import type { AgentGraph } from '../../../shared/agent-graph/agent-graph-types'
import {
  buildLiveAgentGraph,
  type LiveGraphChild,
  type LiveGraphRoot
} from '../../../shared/agent-graph/agent-graph-live-rows'
import { agentHookServer } from '../../agent-hooks/server'

// Rosters forget finished sub-agents, so remember them per pane for the lifetime of a session.
const MAX_TRACKED_PANES = 50
const MAX_CHILDREN_PER_PANE = 300

type PaneHistory = { sessionKey: string; children: Map<string, LiveGraphChild> }

const historyByPane = new Map<string, PaneHistory>()
let subscribed = false

function runStatus(state: AgentSubagentSnapshot['state']): LiveGraphChild['status'] {
  if (state === 'idle') {
    return 'completed'
  }
  return state === 'unverifiable' ? null : 'running'
}

function recordRoster(
  paneKey: string,
  sessionKey: string,
  roster: readonly AgentSubagentSnapshot[],
  now: number
): PaneHistory {
  let history = historyByPane.get(paneKey)
  if (!history || history.sessionKey !== sessionKey) {
    history = { sessionKey, children: new Map() }
  }
  historyByPane.delete(paneKey)
  historyByPane.set(paneKey, history)
  while (historyByPane.size > MAX_TRACKED_PANES) {
    const oldest = historyByPane.keys().next().value
    if (oldest === undefined) {
      break
    }
    historyByPane.delete(oldest)
  }
  const present = new Set(roster.map((child) => child.id))
  for (const [id, known] of history.children) {
    if (!present.has(id) && known.status === 'running') {
      history.children.set(id, { ...known, status: 'completed', lastSeenMs: now })
    }
  }
  for (const child of roster) {
    if (!history.children.has(child.id) && history.children.size >= MAX_CHILDREN_PER_PANE) {
      continue
    }
    const known = history.children.get(child.id)
    history.children.set(child.id, {
      id: child.id,
      agentType: child.agentType ?? known?.agentType ?? null,
      model: child.model ?? known?.model ?? null,
      description: child.description ?? known?.description ?? null,
      status: runStatus(child.state),
      firstSeenMs: known?.firstSeenMs ?? (child.startedAt || now),
      lastSeenMs: now
    })
  }
  return history
}

/** Start remembering rosters before any graph is opened, so short-lived sub-agents are not missed. */
export function startAgentGraphLiveHistory(): void {
  if (subscribed) {
    return
  }
  subscribed = true
  agentHookServer.subscribeEnrichedStatus((payload) => {
    const roster = payload.payload.subagents
    if (roster && roster.length > 0) {
      recordRoster(
        payload.paneKey,
        payload.providerSession?.id ?? payload.paneKey,
        roster,
        Date.now()
      )
    }
  })
  agentHookServer.subscribeStatusDrop((paneKey) => historyByPane.delete(paneKey))
}

/** Null when main has no hook row for the pane. */
export function buildLiveAgentGraphForPane(paneKey: string): AgentGraph | null {
  startAgentGraphLiveHistory()
  const row = agentHookServer.getStatusSnapshotForPane(paneKey).at(0)
  if (!row) {
    return null
  }
  const history = recordRoster(
    paneKey,
    row.providerSession?.id ?? paneKey,
    row.subagents ?? [],
    Date.now()
  )
  const root: LiveGraphRoot = {
    paneKey,
    sessionId: row.providerSession?.id ?? null,
    agentType: row.agentType ?? null,
    model: row.model ?? null,
    prompt: row.prompt || null,
    status: row.state === 'done' ? 'completed' : 'running',
    startedMs: row.turnStartedAt ?? row.stateStartedAt ?? null,
    updatedMs: row.receivedAt
  }
  return buildLiveAgentGraph(root, [...history.children.values()])
}
