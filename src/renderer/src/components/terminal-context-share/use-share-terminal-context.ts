import { useCallback, useEffect, useRef, useState } from 'react'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import {
  TERMINAL_CONTEXT_TITLE_MAX_CHARS,
  type TerminalContextSummaryModelChoice
} from '../../../../shared/terminal-context-share/terminal-context-share-types'
import { translate } from '@/i18n/i18n'
import { createNonSecureContextUuid as createBrowserUuid } from '../../../../shared/non-secure-context-uuid'
import { textGenerationErrorText } from '@/lib/text-generation/text-generation-error-copy'
import {
  readTerminalContextText,
  type TerminalContextReadMode
} from './terminal-context-source-read'
import {
  buildSharedScreenMessage,
  buildSharedSummaryMessage,
  buildSourceReadHint
} from './terminal-context-share-messages'
import {
  deliverTextToTerminal,
  type TerminalContextDeliveryResult
} from './terminal-context-share-delivery'
import type { TerminalContextShareTarget } from './terminal-context-share-targets'

export type ShareTerminalContextStage = 'idle' | 'reading' | 'summarizing' | 'sending'

type ShareRun = { controller: AbortController; requestId: string | null }

function abortRun(run: ShareRun | null): void {
  if (!run) {
    return
  }
  run.controller.abort()
  if (run.requestId) {
    void window.api.terminalContext?.cancel({ requestId: run.requestId }).catch(() => {})
  }
}

export function useShareTerminalContext(args: {
  sourceTitle: string
  sourceHandle: string
  sourceRuntimeTarget: RuntimeClientTarget
  sourceAgent: string | null
}): {
  stage: ShareTerminalContextStage
  preview: string | null
  setPreview: (preview: string) => void
  error: string | null
  generate: (options: {
    mode: TerminalContextReadMode
    choice: TerminalContextSummaryModelChoice
    instruction: string
  }) => Promise<void>
  cancel: () => void
  send: (target: TerminalContextShareTarget) => Promise<TerminalContextDeliveryResult>
} {
  const { sourceTitle, sourceHandle, sourceRuntimeTarget, sourceAgent } = args
  const [stage, setStage] = useState<ShareTerminalContextStage>('idle')
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const runRef = useRef<ShareRun | null>(null)

  useEffect(() => () => abortRun(runRef.current), [])

  const generate = useCallback(
    async ({
      mode,
      choice,
      instruction
    }: {
      mode: TerminalContextReadMode
      choice: TerminalContextSummaryModelChoice
      instruction: string
    }): Promise<void> => {
      abortRun(runRef.current)
      const run: ShareRun = { controller: new AbortController(), requestId: null }
      runRef.current = run
      const isCurrent = (): boolean => runRef.current === run
      setError(null)
      setStage('reading')
      let failure = translate(
        'components.terminalContextShare.readFailed',
        'Could not read the source terminal.'
      )
      try {
        const text = await readTerminalContextText({
          runtimeTarget: sourceRuntimeTarget,
          handle: sourceHandle,
          mode,
          signal: run.controller.signal
        })
        if (!isCurrent()) {
          return
        }
        const source = { title: sourceTitle }
        if (!text.trim()) {
          setError(
            translate(
              'components.terminalContextShare.noOutput',
              'The source terminal has no output to share yet.'
            )
          )
        } else if (mode === 'raw') {
          setPreview(buildSharedScreenMessage({ source, screen: text }))
        } else if (!window.api.terminalContext) {
          setError(
            translate(
              'components.terminalContextShare.summaryUnavailable',
              'Summaries run on the Orca desktop app. Send the raw screen instead.'
            )
          )
        } else {
          run.requestId = createBrowserUuid()
          setStage('summarizing')
          failure = translate(
            'components.terminalContextShare.summaryFailed',
            'Could not summarize the source terminal.'
          )
          const result = await window.api.terminalContext.summarize({
            requestId: run.requestId,
            // Pane titles are OSC-controlled and unbounded; main rejects longer ones.
            sourceTitle: sourceTitle.slice(0, TERMINAL_CONTEXT_TITLE_MAX_CHARS),
            sourceAgent,
            text,
            ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
            agentId: choice.agentId,
            model: choice.model
          })
          if (!isCurrent()) {
            return
          }
          if (result.success) {
            setPreview(
              buildSharedSummaryMessage({
                source,
                modelName: choice.displayName,
                summary: result.summary
              })
            )
          } else if (!result.canceled) {
            setError(textGenerationErrorText(result))
          }
        }
      } catch {
        if (isCurrent()) {
          setError(failure)
        }
      } finally {
        if (isCurrent()) {
          runRef.current = null
          setStage('idle')
        }
      }
    },
    [sourceAgent, sourceHandle, sourceRuntimeTarget, sourceTitle]
  )

  const cancel = useCallback((): void => {
    abortRun(runRef.current)
    runRef.current = null
    setStage('idle')
  }, [])

  const send = useCallback(
    async (target: TerminalContextShareTarget): Promise<TerminalContextDeliveryResult> => {
      setError(null)
      setStage('sending')
      const text = target.onSourceRuntime
        ? `${(preview ?? '').trimEnd()}\n${buildSourceReadHint(sourceHandle)}`
        : (preview ?? '')
      const result = await deliverTextToTerminal(target.runtimeTarget, target.handle, text)
      setStage('idle')
      if (!result.ok) {
        setError(result.message)
      }
      return result
    },
    [preview, sourceHandle]
  )

  return { stage, preview, setPreview, error, generate, cancel, send }
}
