import { useEffect, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import type {
  AgentGraphEdge,
  AgentGraphMessage,
  AgentGraphNode,
  AgentGraphNodeMessagesResult
} from '../../../../shared/agent-graph/agent-graph-types'
import { formatSubagentTokens } from '../../../../shared/native-chat/transcript/native-chat-subagent-group-header'
import { Button } from '@/components/ui/button'
import { useIntlLocale, useTranslate } from '@/i18n/use-translate'
import {
  agentGraphEdgeKindLabel,
  agentGraphMessageRoleLabel,
  agentGraphNodeMessagesUnavailableCopy
} from './agent-graph-copy'
import { agentGraphNodeEdges } from './agent-graph-layout'

type AgentGraphNodeDetailProps = {
  node: AgentGraphNode
  edges: readonly AgentGraphEdge[]
  onClose: () => void
}

export function AgentGraphNodeDetail({
  node,
  edges,
  onClose
}: AgentGraphNodeDetailProps): React.JSX.Element {
  const t = useTranslate()
  const { incoming, results } = agentGraphNodeEdges(edges, node)
  const transcript = useNodeMessages(node)
  const facts = [
    node.agentType,
    node.totalTokens > 0
      ? t('components.agentGraph.AgentGraphNodeDetail.tokens', '{{tokens}} tokens', {
          tokens: formatSubagentTokens(node.totalTokens)
        })
      : null,
    node.messageCount > 0
      ? t('components.agentGraph.AgentGraphNodeDetail.messageCount', '{{count}} messages', {
          count: node.messageCount
        })
      : null
  ].filter(Boolean)
  return (
    <div className="flex max-h-[55%] min-h-0 shrink-0 flex-col border-t border-border">
      <div className="flex h-8 shrink-0 items-center gap-2 pl-3 pr-1">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
          {node.label}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onClose}
          aria-label={t('components.agentGraph.AgentGraphNodeDetail.close', 'Close details')}
        >
          <X />
        </Button>
      </div>
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-muted-foreground">
          {node.model ? <span className="font-mono">{node.model}</span> : null}
          {facts.map((fact) => (
            <span key={fact}>{fact}</span>
          ))}
        </div>
        {incoming.map((edge) => (
          <EdgeSection key={edge.id} edge={edge} />
        ))}
        {results.map((edge) => (
          <EdgeSection key={edge.id} edge={edge} />
        ))}
        <TranscriptSection transcript={transcript} hasTranscript={node.transcriptPath !== null} />
      </div>
    </div>
  )
}

function EdgeSection({ edge }: { edge: AgentGraphEdge }): React.JSX.Element | null {
  const t = useTranslate()
  if (!edge.text) {
    return null
  }
  return (
    <section className="mt-3">
      <h3 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
        {agentGraphEdgeKindLabel(edge.kind, t)}
      </h3>
      <p className="mt-1 whitespace-pre-wrap break-words text-xs text-foreground">{edge.text}</p>
    </section>
  )
}

type NodeMessagesState = { path: string | null; result: AgentGraphNodeMessagesResult | null }

function useNodeMessages(node: AgentGraphNode): NodeMessagesState {
  const [state, setState] = useState<NodeMessagesState>({ path: null, result: null })
  const { provider, transcriptPath } = node
  useEffect(() => {
    if (!transcriptPath) {
      return
    }
    let cancelled = false
    void window.api.aiVault
      .readAgentGraphNodeMessages({ provider, transcriptPath })
      .catch((error: unknown) => ({
        ok: false as const,
        reason: 'unavailable' as const,
        message: error instanceof Error ? error.message : String(error)
      }))
      .then((result) => {
        if (!cancelled) {
          setState({ path: transcriptPath, result })
        }
      })
    return () => {
      cancelled = true
    }
  }, [provider, transcriptPath])
  return state.path === transcriptPath ? state : { path: transcriptPath, result: null }
}

function TranscriptSection({
  transcript,
  hasTranscript
}: {
  transcript: NodeMessagesState
  hasTranscript: boolean
}): React.JSX.Element | null {
  const t = useTranslate()
  if (!hasTranscript) {
    return null
  }
  const heading = (
    <h3 className="mt-3 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
      {t('components.agentGraph.AgentGraphNodeDetail.transcript', 'Transcript')}
    </h3>
  )
  const { result } = transcript
  if (!result) {
    return (
      <section>
        {heading}
        <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {t('components.agentGraph.AgentGraphNodeDetail.loading', 'Reading transcript…')}
        </div>
      </section>
    )
  }
  if (!result.ok) {
    return (
      <section>
        {heading}
        <p className="mt-1 text-xs text-destructive">
          {agentGraphNodeMessagesUnavailableCopy(result, t)}
        </p>
      </section>
    )
  }
  return (
    <section>
      {heading}
      {result.openingPrompt ? <MessageRow message={result.openingPrompt} /> : null}
      {result.truncated ? (
        <p className="mt-2 text-2xs text-muted-foreground">
          {t(
            'components.agentGraph.AgentGraphNodeDetail.olderSkipped',
            'Older messages are not shown.'
          )}
        </p>
      ) : null}
      {result.messages.map((message) => (
        <MessageRow key={message.id} message={message} />
      ))}
    </section>
  )
}

function MessageRow({ message }: { message: AgentGraphMessage }): React.JSX.Element {
  const t = useTranslate()
  const locale = useIntlLocale()
  return (
    <div className="mt-2 border-l border-border pl-2">
      <div className="flex items-center gap-2 text-2xs text-muted-foreground">
        <span className="font-medium text-foreground">
          {agentGraphMessageRoleLabel(message.role, t)}
        </span>
        {message.model ? <span className="font-mono">{message.model}</span> : null}
        {message.at ? <span>{new Date(message.at).toLocaleTimeString(locale)}</span> : null}
      </div>
      <p className="mt-0.5 line-clamp-6 whitespace-pre-wrap break-words text-xs text-foreground">
        {message.text}
      </p>
    </div>
  )
}
