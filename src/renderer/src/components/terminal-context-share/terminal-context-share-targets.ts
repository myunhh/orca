import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type {
  RuntimeTerminalListResult,
  RuntimeTerminalSummary
} from '../../../../shared/runtime-terminal-contracts'
import { formatAgentTypeLabel } from '../../../../shared/agent-status/presentation/agent-type-label'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'

export type TerminalContextShareTarget = {
  key: string
  handle: string
  runtimeTarget: RuntimeClientTarget
  title: string
  worktreeLabel: string
  agentLabel: string | null
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
  runtimeTarget: RuntimeClientTarget
): TerminalContextShareTarget {
  return {
    key: `${runtimeTargetKey(runtimeTarget)}:${terminal.handle}`,
    handle: terminal.handle,
    runtimeTarget,
    title: terminal.paneTitle || terminal.title || terminal.handle,
    worktreeLabel: worktreeLabel(terminal),
    agentLabel: terminal.agentIdentity ? formatAgentTypeLabel(terminal.agentIdentity) : null
  }
}

/** Live, writable terminals on every runtime involved, agents first; the source itself is excluded. */
export async function listTerminalContextShareTargets(args: {
  runtimeTargets: RuntimeClientTarget[]
  sourceHandle: string
  signal?: AbortSignal
}): Promise<{ targets: TerminalContextShareTarget[]; sourceAgentLabel: string | null }> {
  const seen = new Set<string>()
  const runtimeTargets = args.runtimeTargets.filter((target) => {
    const key = runtimeTargetKey(target)
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
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
    for (const terminal of listing.value.terminals) {
      if (terminal.handle === args.sourceHandle) {
        sourceAgentLabel = toTarget(terminal, listing.value.runtimeTarget).agentLabel
        continue
      }
      if (terminal.orphaned || !terminal.connected || !terminal.writable) {
        continue
      }
      targets.push(toTarget(terminal, listing.value.runtimeTarget))
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
