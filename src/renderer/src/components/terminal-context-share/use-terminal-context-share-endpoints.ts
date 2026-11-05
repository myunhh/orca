import { useEffect, useState } from 'react'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { TerminalContextShareSource } from './terminal-context-share-request'
import {
  resolveTerminalContextShareSourceHandle,
  terminalContextShareRuntimeTarget
} from './terminal-context-share-source'
import {
  listTerminalContextShareTargets,
  type TerminalContextShareTarget
} from './terminal-context-share-targets'

export type TerminalContextShareEndpoints =
  | { status: 'loading' }
  | { status: 'error'; reason: 'source-unavailable' | 'targets-unavailable' }
  | {
      status: 'ready'
      sourceHandle: string
      sourceRuntimeTarget: RuntimeClientTarget
      sourceAgentLabel: string | null
      targets: TerminalContextShareTarget[]
    }

/** Resolves the source's Orca handle and lists the terminals it can share with. */
export function useTerminalContextShareEndpoints(
  source: TerminalContextShareSource
): TerminalContextShareEndpoints {
  const [endpoints, setEndpoints] = useState<TerminalContextShareEndpoints>({ status: 'loading' })
  useEffect(() => {
    const controller = new AbortController()
    const sourceRuntimeTarget = terminalContextShareRuntimeTarget(source)
    const load = async (): Promise<TerminalContextShareEndpoints> => {
      let sourceHandle: string
      try {
        sourceHandle = await resolveTerminalContextShareSourceHandle(source)
      } catch {
        return { status: 'error', reason: 'source-unavailable' }
      }
      try {
        const listing = await listTerminalContextShareTargets({
          sourceRuntimeTarget,
          extraRuntimeTargets: [{ kind: 'local' }],
          sourceHandle,
          signal: controller.signal
        })
        return { status: 'ready', sourceHandle, sourceRuntimeTarget, ...listing }
      } catch {
        return { status: 'error', reason: 'targets-unavailable' }
      }
    }
    void load().then((next) => {
      if (!controller.signal.aborted) {
        setEndpoints(next)
      }
    })
    return () => controller.abort()
  }, [source])
  return endpoints
}
