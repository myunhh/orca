import type { Store } from '../../../persistence/loading-store/store'
import type {
  HostLineageSnapshot,
  ListDesktopLineageForHostArgs
} from '../../../../shared/host-lineage-contract'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'
import { resolveWorktreeMetaOwner } from '../../../persistence/host-qualified-worktree-meta'
import { resolveQualifiedFolderWorkspaceResult } from '../../../../shared/folder-workspaces/folder-workspace-execution-host'
import { listReposForExecutionHost } from '../../repos/host-repo-catalog-snapshot'

export function listDesktopLineageForHost(
  store: Store,
  args: ListDesktopLineageForHostArgs
): HostLineageSnapshot {
  const catalog = listReposForExecutionHost(store, args)
  if (!catalog.authoritative) {
    return catalog
  }
  const hostId = catalog.authority.executionHostId
  const folderState = {
    folderWorkspaces: store.getFolderWorkspaces(),
    projectGroups: store.getProjectGroups(),
    repos: store.getRepos()
  }
  const lineage = Object.fromEntries(
    Object.entries(store.getAllWorktreeLineage()).filter(
      ([id, row]) =>
        resolveWorktreeMetaOwner(store, id)?.hostId === hostId &&
        resolveWorktreeMetaOwner(store, row.parentWorktreeId)?.hostId === hostId
    )
  )
  const workspaceLineage = Object.fromEntries(
    Object.entries(store.getAllWorkspaceLineage()).filter(([key, row]) => {
      for (const workspaceKey of [key, row.parentWorkspaceKey]) {
        const workspace = parseWorkspaceKey(workspaceKey)
        if (!workspace) {
          return false
        }
        if (workspace.type === 'worktree') {
          if (resolveWorktreeMetaOwner(store, workspace.worktreeId)?.hostId !== hostId) {
            return false
          }
        } else {
          const folder = resolveQualifiedFolderWorkspaceResult(
            folderState,
            workspace.folderWorkspaceId
          )
          if (folder.kind !== 'selected' || folder.value.hostId !== hostId) {
            return false
          }
        }
      }
      return true
    })
  )
  return { authoritative: true, authority: catalog.authority, lineage, workspaceLineage }
}
