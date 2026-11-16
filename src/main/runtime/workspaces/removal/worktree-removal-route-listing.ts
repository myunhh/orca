import type { Repo } from '../../../../shared/repo-types'
import type { ProjectRuntimeResolutionStore } from '../../../workspaces/execution-host/local-project-runtime-resolution'
import type { GitWorktreeInfo } from '../../../../shared/worktree/types'
import type { WorktreeRemovalRoute } from '../../../workspaces/removal/worktree-removal-execution-host-route'
import type { LocalProjectWorktreeGitOptions } from '../../../workspaces/execution-host/project-runtime-git-options'
import { getLocalProjectWorktreeGitOptions } from '../../../workspaces/execution-host/project-runtime-git-options'
import { listWorktreesStrict } from '../../../git/worktrees/catalog/worktree-listing'

/** Use the same verified owner for registration proof and the later destructive operation. */
export async function listWorktreesOnRemovalRoute(
  route: WorktreeRemovalRoute,
  repo: Repo,
  store: ProjectRuntimeResolutionStore
): Promise<{
  localWorktreeGitOptions: LocalProjectWorktreeGitOptions
  registeredWorktrees: GitWorktreeInfo[]
}> {
  if (route.kind === 'ssh') {
    return {
      localWorktreeGitOptions: {},
      registeredWorktrees: await route.provider.listWorktrees(repo.path)
    }
  }
  const localWorktreeGitOptions = getLocalProjectWorktreeGitOptions(store, repo)
  return {
    localWorktreeGitOptions,
    registeredWorktrees: Object.keys(localWorktreeGitOptions).length
      ? await listWorktreesStrict(repo.path, localWorktreeGitOptions)
      : await listWorktreesStrict(repo.path)
  }
}
