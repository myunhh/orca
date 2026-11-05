import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AgentGraphBuildArgs,
  AgentGraphBuildResult
} from '../../../../shared/agent-graph/agent-graph-types'

const AUTO_REFRESH_MS = 5_000

export type AgentGraphLoadState = {
  /** Last answer for the current pane; kept while a refresh runs so the canvas does not flash. */
  result: AgentGraphBuildResult | null
  loading: boolean
  refresh: () => void
}

/** Builds the pane's graph, then rebuilds every few seconds while the panel is visible. */
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
  fallbackRef.current = args.fallback

  useEffect(() => {
    if (!paneKey || !isVisible) {
      return
    }
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const load = async (): Promise<void> => {
      setLoading(true)
      try {
        const fallback = fallbackRef.current
        const result = await window.api.aiVault.buildAgentGraph({
          paneKey,
          ...(fallback ? { fallback } : {})
        })
        if (!cancelled) {
          setState({ paneKey, result })
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            paneKey,
            result: {
              ok: false,
              reason: 'unavailable',
              message: error instanceof Error ? error.message : String(error)
            }
          })
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
          timer = setTimeout(() => void load(), AUTO_REFRESH_MS)
        }
      }
    }
    void load()
    return () => {
      cancelled = true
      setLoading(false)
      if (timer) {
        clearTimeout(timer)
      }
    }
  }, [paneKey, isVisible, refreshToken])

  const refresh = useCallback(() => setRefreshToken((token) => token + 1), [])
  return {
    result: state.paneKey === paneKey ? state.result : null,
    loading,
    refresh
  }
}
