import type { DirectSshAuthority } from '../../../shared/ssh-types'
import { getRepoExecutionHostId, toSshExecutionHostId } from '../../../shared/execution-host'
import { applyManualRepoOrder } from '../../../shared/manual-repo-order'
import { useAppStore } from '../store'
import { mergeFetchedReposForHost } from '../store/repos/repo-catalog-identity'
import { reconcileDirectSshTargetTerminals } from '../store/terminals/direct-ssh-terminal-bindings'
import { directSshAuthoritiesEqual } from '../store/slices/worktrees/listing/direct-ssh-authority'
import {
  mergeLineageForHost,
  mergeWorkspaceLineageForHost
} from '../store/slices/worktrees/metadata/worktree-lineage-host-merge'

type HostRefresh = {
  authority: DirectSshAuthority
  revision: number
  remountBoundPanes: boolean
  promise: Promise<void>
}

export function createDirectSshHostHydration(deps: {
  currentAuthority: (targetId: string) => DirectSshAuthority | null
  isStopped: () => boolean
}) {
  const pending = new Map<string, HostRefresh>()
  const deadlines = new Set<() => void>()
  let stopped = false
  const isCurrent = (authority: DirectSshAuthority): boolean =>
    !stopped &&
    !deps.isStopped() &&
    directSshAuthoritiesEqual(deps.currentAuthority(authority.targetId), authority)
  const bounded = async <T>(operation: Promise<T>): Promise<T | null> => {
    const { promise, resolve } = Promise.withResolvers<null>()
    const settle = () => resolve(null)
    deadlines.add(settle)
    const timer = setTimeout(settle, 5_000)
    try {
      return await Promise.race([operation, promise])
    } finally {
      clearTimeout(timer)
      deadlines.delete(settle)
    }
  }
  const hydrate = async (refresh: HostRefresh, revision: number): Promise<void> => {
    const { authority } = refresh
    const executionHostId = toSshExecutionHostId(authority.targetId)
    const reposAtRequest = useAppStore.getState().repos
    const catalog = await bounded(
      window.api.repos.listForExecutionHost({ executionHostId, expectedAuthority: authority })
    )
    if (
      !catalog?.authoritative ||
      !isCurrent(authority) ||
      revision !== refresh.revision ||
      catalog.authority.executionHostId !== executionHostId ||
      !directSshAuthoritiesEqual(catalog.authority, authority) ||
      catalog.repos.some((repo) => getRepoExecutionHostId(repo) !== executionHostId)
    ) {
      return
    }
    useAppStore.setState((state) => ({
      repos: mergeFetchedReposForHost(
        state.repos,
        applyManualRepoOrder(catalog.repos, state.manualRepoOrder),
        executionHostId,
        reposAtRequest
      )
    }))
    const repos = useAppStore
      .getState()
      .repos.filter((repo) => getRepoExecutionHostId(repo) === executionHostId)
    let nextIndex = 0
    const drain = async (): Promise<void> => {
      while (nextIndex < repos.length && isCurrent(authority) && revision === refresh.revision) {
        const repo = repos[nextIndex++]
        await useAppStore.getState().fetchWorktrees(repo.id, {
          executionHostId,
          directSshAuthority: authority,
          requireAuthoritative: true,
          forceFresh: true
        })
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, repos.length) }, drain))
    if (!isCurrent(authority) || revision !== refresh.revision) {
      return
    }
    const beforeLineage = useAppStore.getState()
    const lineage = await bounded(
      window.api.worktrees.listLineageForHost({ executionHostId, expectedAuthority: authority })
    )
    if (!isCurrent(authority) || revision !== refresh.revision) {
      return
    }
    if (
      lineage?.authoritative &&
      lineage.authority.executionHostId === executionHostId &&
      directSshAuthoritiesEqual(lineage.authority, authority)
    ) {
      useAppStore.setState((state) => ({
        worktreeLineageById: mergeLineageForHost(
          state,
          executionHostId,
          lineage.lineage,
          beforeLineage.worktreeLineageById
        ),
        workspaceLineageByChildKey: mergeWorkspaceLineageForHost(
          state,
          executionHostId,
          lineage.workspaceLineage,
          beforeLineage.workspaceLineageByChildKey
        )
      }))
    }
    reconcileDirectSshTargetTerminals(authority, refresh.remountBoundPanes)
    refresh.remountBoundPanes = false
  }
  return {
    refresh(authority: DirectSshAuthority, remountBoundPanes: boolean): Promise<void> {
      const prior = pending.get(authority.targetId)
      if (prior && directSshAuthoritiesEqual(prior.authority, authority)) {
        prior.revision += 1
        prior.remountBoundPanes ||= remountBoundPanes
        return prior.promise
      }
      const refresh: HostRefresh = {
        authority,
        revision: 0,
        remountBoundPanes,
        promise: Promise.resolve()
      }
      pending.set(authority.targetId, refresh)
      refresh.promise = (async () => {
        let revision: number
        do {
          revision = refresh.revision
          try {
            await hydrate(refresh, revision)
          } catch (error) {
            if (isCurrent(authority)) {
              console.warn(`[direct-ssh] failed to hydrate host ${authority.targetId}:`, error)
            }
          }
        } while (isCurrent(authority) && revision !== refresh.revision)
      })().finally(() => {
        if (pending.get(authority.targetId) === refresh) {
          pending.delete(authority.targetId)
        }
      })
      return refresh.promise
    },
    stop(): void {
      stopped = true
      for (const settle of deadlines) {
        settle()
      }
      deadlines.clear()
      pending.clear()
    }
  }
}
