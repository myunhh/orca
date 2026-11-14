import { useCallback, useEffect, useRef, useState } from 'react'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'
import type {
  AgentGraphBuildArgs,
  AgentGraphBuildResult
} from '../../../../shared/agent-graph/agent-graph-types'

const AUTO_REFRESH_MS = 5_000
// Timeouts and unreadable transcripts rarely clear within seconds; back off instead of re-sending.
const FAILED_REFRESH_MS = 30_000

export type AgentGraphLoadState = {
  /** Last answer for the current pane; kept while a refresh runs so the canvas does not flash. */
  result: AgentGraphBuildResult | null
  loading: boolean
  refresh: () => void
}

async function requestAgentGraph(args: AgentGraphBuildArgs): Promise<AgentGraphBuildResult> {
  try {
    return await window.api.aiVault.buildAgentGraph(args)
  } catch (error) {
    return {
      ok: false,
      reason: 'unavailable',
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

/** Builds the pane's graph, then rebuilds every few seconds (slower after a failure) while visible. */
export function useAgentGraph(args: {
  paneKey: string | null
  fallback: AgentGraphBuildArgs['fallback']
  isVisible: boolean
}): AgentGraphLoadState {
  const { paneKey, isVisible } = args
  const [state, setState] = useState<{
    paneKey: string | null
    result: AgentGraphBuildResult | null
  }>({ paneKey: null, result: null })
  const [loading, setLoading] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)
  const fallbackRef = useRef(args.fallback)
  useEffect(() => {
    fallbackRef.current = args.fallback
  }, [args.fallback])

  useEffect(() => {
    if (!paneKey || !isVisible) {
      return
    }
    let cancelled = false
    let inFlight = false
    let backoffUntil = 0
    const load = async (): Promise<void> => {
      // A slow build must not stack polls behind it; a failed one waits out its backoff.
      if (inFlight || Date.now() < backoffUntil) {
        return
      }
      inFlight = true
      setLoading(true)
      const fallback = fallbackRef.current
      const result = await requestAgentGraph({
        paneKey,
        ...(fallback ? { fallback } : {})
      })
      inFlight = false
      backoffUntil = result.ok ? 0 : Date.now() + FAILED_REFRESH_MS
      if (!cancelled) {
        setState({ paneKey, result })
        setLoading(false)
      }
    }
    const stopRefresh = installWindowVisibilityInterval({
      run: () => void load(),
      intervalMs: AUTO_REFRESH_MS
    })
    return () => {
      cancelled = true
      stopRefresh()
      setLoading(false)
    }
  }, [paneKey, isVisible, refreshToken])

  const refresh = useCallback(() => setRefreshToken((token) => token + 1), [])
  return {
    result: state.paneKey === paneKey ? state.result : null,
    loading,
    refresh
  }
}
