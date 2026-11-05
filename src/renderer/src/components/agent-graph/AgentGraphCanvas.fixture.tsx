import type {
  AgentGraphEdge,
  AgentGraphNode
} from '../../../../shared/agent-graph/agent-graph-types'
import { defineFixture } from '../../component-fixtures/component-fixture'
import { AgentGraphCanvas } from './AgentGraphCanvas'
import { AgentGraphNodeDetail } from './AgentGraphNodeDetail'

function node(
  fields: Partial<AgentGraphNode> & Pick<AgentGraphNode, 'id' | 'label'>
): AgentGraphNode {
  return {
    provider: 'claude',
    parentId: 'root',
    role: 'subagent',
    agentType: 'general-purpose',
    model: 'claude-opus-5-5',
    status: 'completed',
    transcriptPath: null,
    startedAt: null,
    updatedAt: null,
    totalTokens: 182_000,
    messageCount: 40,
    depth: 1,
    ...fields
  }
}

const NODES: AgentGraphNode[] = [
  node({
    id: 'root',
    label: 'Refactor the session scanner',
    parentId: null,
    role: 'root',
    agentType: null,
    depth: 0,
    status: null,
    totalTokens: 2_400_000
  }),
  node({
    id: 'claude:a1',
    label: 'Map the scanner internals',
    agentType: 'Explore',
    model: 'claude-haiku-4-5'
  }),
  node({
    id: 'workflow:wf_1',
    label: 'orca-feature-recon',
    role: 'workflow',
    agentType: 'workflow',
    status: 'running'
  }),
  node({
    id: 'claude:w1',
    parentId: 'workflow:wf_1',
    label: 'recon:windows',
    agentType: 'workflow-subagent',
    depth: 2
  }),
  node({
    id: 'claude:w2',
    parentId: 'workflow:wf_1',
    label: 'recon:terminals',
    agentType: 'workflow-subagent',
    status: 'running',
    depth: 2
  }),
  node({
    id: 'claude:w3',
    parentId: 'workflow:wf_1',
    label: 'recon:ui',
    agentType: 'workflow-subagent',
    status: 'failed',
    depth: 2
  })
]

const EDGES: AgentGraphEdge[] = [
  {
    id: 'e1',
    from: 'root',
    to: 'claude:a1',
    kind: 'spawn',
    at: null,
    text: 'Find every caller of parseClaudeSessionFile and summarize how status is derived.'
  },
  {
    id: 'e2',
    from: 'root',
    to: 'claude:a1',
    kind: 'message',
    at: null,
    text: 'Also check the OMP listing.'
  },
  {
    id: 'e3',
    from: 'claude:a1',
    to: 'root',
    kind: 'result',
    at: null,
    text: 'Three callers; status comes from toolUseResult and task notifications.'
  },
  {
    id: 'e4',
    from: 'root',
    to: 'workflow:wf_1',
    kind: 'spawn',
    at: null,
    text: 'Map Orca subsystems'
  },
  { id: 'e5', from: 'workflow:wf_1', to: 'claude:w1', kind: 'spawn', at: null },
  {
    id: 'e6',
    from: 'claude:w1',
    to: 'workflow:wf_1',
    kind: 'result',
    at: null,
    text: 'Window report'
  },
  { id: 'e7', from: 'workflow:wf_1', to: 'claude:w2', kind: 'spawn', at: null },
  { id: 'e8', from: 'workflow:wf_1', to: 'claude:w3', kind: 'spawn', at: null }
]

export const tree = defineFixture({
  width: 360,
  render: () => (
    <div className="flex h-[460px] flex-col">
      <AgentGraphCanvas
        nodes={NODES}
        edges={EDGES}
        selectedNodeId="claude:a1"
        onSelectNode={() => {}}
      />
      <AgentGraphNodeDetail node={NODES[1]!} edges={EDGES} onClose={() => {}} />
    </div>
  )
})
