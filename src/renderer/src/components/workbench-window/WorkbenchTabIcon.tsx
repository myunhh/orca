import { FileText, Image, SquareTerminal } from 'lucide-react'
import { AgentStateDot, type AgentDotState } from '@/components/AgentStateDot'

const AGENT_DOT_STATES: readonly AgentDotState[] = [
  'working',
  'monitoring',
  'permission',
  'failed',
  'interrupted',
  'unconfirmed',
  'done'
]

function toAgentDotState(value: string | null): AgentDotState | null {
  return AGENT_DOT_STATES.find((state) => state === value) ?? null
}

/** A live agent's status dot, else the tab kind's icon. */
export function WorkbenchTabIcon({
  kind,
  agentState,
  isImage
}: {
  kind: 'terminal' | 'editor'
  agentState: string | null
  isImage: boolean
}): React.JSX.Element {
  const dotState = toAgentDotState(agentState)
  if (dotState) {
    return <AgentStateDot state={dotState} size="md" title={null} />
  }
  if (kind === 'terminal') {
    return <SquareTerminal className="size-3.5 shrink-0" />
  }
  return isImage ? (
    <Image className="size-3.5 shrink-0" />
  ) : (
    <FileText className="size-3.5 shrink-0" />
  )
}
