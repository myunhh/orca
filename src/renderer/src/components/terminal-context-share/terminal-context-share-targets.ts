import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type {
  RuntimeTerminalListResult,
  RuntimeTerminalSummary
} from '../../../../shared/runtime-terminal-contracts'
import { formatAgentTypeLabel } from '../../../../shared/agent-status/presentation/agent-type-label'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'

export type TerminalContextShareTarget = {
  key: string
  handle: string
  runtimeTarget: RuntimeClientTarget
  title: string
  worktreeLabel: string
  agentLabel: string | null
  tabId: string
  leafId: string
  /** Handles are runtime-scoped: only same-runtime agents can reach this one with `orca terminal`. */
  onSourceRuntime: boolean
}

const TARGET_LIST_TIMEOUT_MS = 8000

function runtimeTargetKey(target: RuntimeClientTarget): string {
  return target.kind === 'environment' ? `env:${target.environmentId}` : 'local'
}

function worktreeLabel(terminal: RuntimeTerminalSummary): string {
  if (terminal.branch) {
    return terminal.branch.replace(/^refs\/heads\//, '')
  }
  const parts = terminal.worktreePath.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? terminal.worktreePath
}

function toTarget(
  terminal: RuntimeTerminalSummary,
  runtimeTarget: RuntimeClientTarget,
  onSourceRuntime: boolean
): TerminalContextShareTarget {
  return {
    onSourceRuntime,
    key: `${runtimeTargetKey(runtimeTarget)}:${terminal.handle}`,
    handle: terminal.handle,
    tabId: terminal.tabId,
    leafId: terminal.leafId,
    runtimeTarget,
    title: terminal.paneTitle || terminal.title || terminal.handle,
    worktreeLabel: worktreeLabel(terminal),
    agentLabel: terminal.agentIdentity ? formatAgentTypeLabel(terminal.agentIdentity) : null
  }
}

/** Live, writable terminals on the source's runtime plus extra runtimes, agents first; the source itself is excluded. */
export async function listTerminalContextShareTargets(args: {
  sourceRuntimeTarget: RuntimeClientTarget
  extraRuntimeTargets: RuntimeClientTarget[]
  sourceHandle: string
  signal?: AbortSignal
}): Promise<{ targets: TerminalContextShareTarget[]; sourceAgentLabel: string | null }> {
  const sourceRuntimeKey = runtimeTargetKey(args.sourceRuntimeTarget)
  const seen = new Set<string>()
  const runtimeTargets = [args.sourceRuntimeTarget, ...args.extraRuntimeTargets].filter(
    (target) => {
      const key = runtimeTargetKey(target)
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    }
  )
  const listings = await Promise.allSettled(
    runtimeTargets.map(async (runtimeTarget) => {
      const result = await callRuntimeRpc<RuntimeTerminalListResult>(
        runtimeTarget,
        'terminal.list',
        { includePreview: false, includeVisualLayouts: false },
        { timeoutMs: TARGET_LIST_TIMEOUT_MS, signal: args.signal }
      )
      return { runtimeTarget, terminals: result.terminals }
    })
  )
  const targets: TerminalContextShareTarget[] = []
  let sourceAgentLabel: string | null = null
  for (const listing of listings) {
    if (listing.status !== 'fulfilled') {
      continue
    }
    const onSourceRuntime = runtimeTargetKey(listing.value.runtimeTarget) === sourceRuntimeKey
    for (const terminal of listing.value.terminals) {
      if (onSourceRuntime && terminal.handle === args.sourceHandle) {
        sourceAgentLabel = toTarget(terminal, listing.value.runtimeTarget, true).agentLabel
        continue
      }
      if (terminal.orphaned || !terminal.connected || !terminal.writable) {
        continue
      }
      targets.push(toTarget(terminal, listing.value.runtimeTarget, onSourceRuntime))
    }
  }
  if (targets.length === 0 && listings.every((listing) => listing.status === 'rejected')) {
    throw new Error('terminal-list-failed')
  }
  targets.sort(
    (a, b) =>
      Number(b.agentLabel !== null) - Number(a.agentLabel !== null) ||
      a.worktreeLabel.localeCompare(b.worktreeLabel) ||
      a.title.localeCompare(b.title)
  )
  return { targets, sourceAgentLabel }
}
