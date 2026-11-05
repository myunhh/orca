import type { AgentGraph, AgentGraphProvider } from '../../../shared/agent-graph/agent-graph-types'
import { AgentGraphAccumulator } from './agent-graph-accumulator'
import { buildClaudeAgentGraph } from './agent-graph-claude'
import { buildCodexAgentGraph } from './agent-graph-codex'
import { buildOmpAgentGraph } from './agent-graph-omp'

export type AgentGraphBuildRequest = {
  provider: AgentGraphProvider
  /** Already admitted against the provider's session roots by the caller. */
  transcriptPath: string
}

const BUILDERS: Record<
  AgentGraphProvider,
  (acc: AgentGraphAccumulator, rootPath: string) => Promise<string>
> = {
  claude: buildClaudeAgentGraph,
  codex: buildCodexAgentGraph,
  omp: buildOmpAgentGraph
}

export async function buildAgentGraph(request: AgentGraphBuildRequest): Promise<AgentGraph> {
  const acc = new AgentGraphAccumulator(request.provider)
  const rootSessionId = await BUILDERS[request.provider](acc, request.transcriptPath)
  return acc.finish(rootSessionId, request.transcriptPath)
}
