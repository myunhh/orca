import type { AgentGraph } from '../../../shared/agent-graph/agent-graph-types'
import type { AgentGraphBuildRequest } from '../../ai-vault/agent-graph/agent-graph-builder'
import { buildAgentGraphInBackground } from '../../ai-vault/scan-service/session-scanner-background'

type InFlightAgentGraphBuild = {
  key: string
  controller: AbortController
  promise: Promise<AgentGraph>
}

const inFlightBySender = new Map<number, InFlightAgentGraphBuild>()

/** One build per renderer: a repeat (poll, refresh click) joins the running build; another pane cancels it. */
export function buildAgentGraphForSender(
  senderId: number,
  request: AgentGraphBuildRequest
): Promise<AgentGraph> {
  const key = `${request.provider}\0${request.transcriptPath}`
  const current = inFlightBySender.get(senderId)
  if (current?.key === key) {
    return current.promise
  }
  current?.controller.abort()
  const controller = new AbortController()
  const promise = buildAgentGraphInBackground(request, controller.signal).finally(() => {
    if (inFlightBySender.get(senderId)?.controller === controller) {
      inFlightBySender.delete(senderId)
    }
  })
  inFlightBySender.set(senderId, { key, controller, promise })
  return promise
}
