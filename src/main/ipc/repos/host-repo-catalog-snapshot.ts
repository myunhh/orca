import type { Store } from '../../persistence/loading-store/store'
import type {
  HostRepoCatalogSnapshot,
  ListReposForExecutionHostArgs
} from '../../../shared/host-repo-catalog-contract'
import { getRepoExecutionHostId, parseExecutionHostId } from '../../../shared/execution-host'
import { isAdmissibleDirectSshAuthority } from '../../../shared/ssh-retained-payload-admission'
import { isCurrentSshProviderAuthority } from '../../ssh/connection/authority/ssh-provider-authority'
import { getSshGitProvider } from '../../providers/ssh-git-dispatch'
import { visibleRepos } from '../../persistence/migrating-orcad-catalog/source/catalog/orcad-source-visibility'
import { resolveRepoOwnershipEvidence } from '../worktrees/listing/worktree-host-ownership'

export function listReposForExecutionHost(
  store: Store,
  args: ListReposForExecutionHostArgs
): HostRepoCatalogSnapshot {
  const host = parseExecutionHostId(args?.executionHostId)
  const rejected = (reason: 'stale' | 'unavailable' | 'rejected'): HostRepoCatalogSnapshot => ({
    authoritative: false,
    executionHostId: args?.executionHostId ?? '',
    reason
  })
  if (
    host?.kind !== 'ssh' ||
    !isAdmissibleDirectSshAuthority(args.expectedAuthority) ||
    args.expectedAuthority.targetId !== host.targetId
  ) {
    return rejected('rejected')
  }
  if (!isCurrentSshProviderAuthority(args.expectedAuthority)) {
    return rejected('stale')
  }
  if (!getSshGitProvider(host.targetId)) {
    return rejected('unavailable')
  }
  const repos = visibleRepos(store)
  if (
    repos.some(
      (repo) =>
        (getRepoExecutionHostId(repo) === host.id || repo.connectionId === host.targetId) &&
        resolveRepoOwnershipEvidence(repo).status !== 'owned'
    )
  ) {
    return rejected('rejected')
  }
  return {
    authoritative: true,
    authority: { executionHostId: host.id, ...args.expectedAuthority },
    repos: structuredClone(repos.filter((repo) => getRepoExecutionHostId(repo) === host.id))
  }
}
