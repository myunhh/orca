import type { Repo } from './repo-types'
import type { DirectSshAuthority } from './ssh-types'
import type { SshExecutionHostId } from './detected-worktree-provider-contract'

export type ListReposForExecutionHostArgs = {
  executionHostId: SshExecutionHostId
  expectedAuthority: DirectSshAuthority
}

export type HostRepoCatalogSnapshot =
  | {
      authoritative: true
      authority: DirectSshAuthority & { executionHostId: SshExecutionHostId }
      repos: readonly Repo[]
    }
  | {
      authoritative: false
      executionHostId: string
      reason: 'stale' | 'unavailable' | 'rejected'
    }
