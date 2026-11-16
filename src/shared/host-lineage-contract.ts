import type { ListReposForExecutionHostArgs } from './host-repo-catalog-contract'
import type { WorktreeLineage, WorkspaceLineage } from './worktree/lineage-types'

export type ListDesktopLineageForHostArgs = ListReposForExecutionHostArgs
export type HostLineageSnapshot =
  | {
      authoritative: true
      authority: ListReposForExecutionHostArgs['expectedAuthority'] & {
        executionHostId: ListReposForExecutionHostArgs['executionHostId']
      }
      lineage: Readonly<Record<string, WorktreeLineage>>
      workspaceLineage: Readonly<Record<string, WorkspaceLineage>>
    }
  | {
      authoritative: false
      executionHostId: string
      reason: 'stale' | 'unavailable' | 'rejected'
    }
