import type { Repo } from '../../../../shared/repo-types'
import { WorktreeCreateCollisionError } from '../../../../shared/new-workspace/worktree-create-collision'
import { isGeneratedWorktreeCreateName } from '../../../../shared/new-workspace/worktree-create-retry-policy'
import { createRetiredNameLookup } from '../../../../shared/worktree/retired-name-registry'
import { getRepoExecutionHostId } from '../../../../shared/execution-host'
import {
  computeRemoteWorktreePath,
  getWorktreePathSettings,
  hasRepoWorktreeBasePath,
  sanitizeWorktreeName
} from '../../../ipc/worktree-logic'
import { computeValidatedBranchName } from '../../../ipc/worktree-branch-name'
import { isENOENT } from '../../../ipc/filesystem/access/filesystem-path-containment'
import { resolveWorktreeCreateDisplayNameRequest } from '../../../ipc/worktree-display-name'
import {
  getBranchConflictKindViaExec,
  getBranchConflictKindStrictViaExec,
  foldGitRefNameCase
} from '../../../git/refs/resolution/repo-branch-conflict'
import {
  normalizeGitUsername,
  isBranchSafeHostedLogin
} from '../../../git/repositories/git-username'
import {
  getBranchNameOverrideCandidate,
  getGeneratedWorktreeCreateCandidate,
  getWorktreeCreateCandidate,
  WORKTREE_CREATE_MAX_SUFFIX_ATTEMPTS
} from '../../../workspaces/creation/worktree-create-candidates'
import {
  exactNameBranchConflict,
  exactNameTakenError
} from '../../../workspaces/creation/worktree-create-exact-name'
import {
  hasRetiredNameRegistryStore,
  getRetiredNameRegistryForRepo
} from '../../../workspaces/removal/retirement/worktree-name-retirement'
import { findPendingWorktreeRemovalConflict } from '../../../workspaces/removal/worktree-removal-table'
import type { WorktreeCreatePathClaim } from '../../../workspaces/creation/worktree-create-in-flight'
import type { SshGitProvider } from '../../../providers/ssh-git-provider'
import type { IFilesystemProvider } from '../../../providers/filesystem-provider-contract'
import type { RuntimeStore } from '../../construction/runtime-store-contract'
import {
  getSelectedReviewBranch,
  isAllowedPushTargetRemoteConflict
} from '../../integrations/reviews/selected-review-branch'
import { getSelectedHostedReviewForBranch } from './runtime-worktree-create-git'
import type { RuntimeManagedWorktreeCreateArgs } from './runtime-managed-worktree-create-types'
import type { RemoteTrackingBase } from '../../repositories/runtime-remote-fetch-controller'
import { sshCommitRef } from './runtime-ssh-worktree-create-base'

export async function sshPathExists(fs: IFilesystemProvider, path: string): Promise<boolean> {
  try {
    await fs.stat(path)
    return true
  } catch (error) {
    if (isENOENT(error)) {
      return false
    }
    throw error
  }
}

async function sshGitUsername(provider: SshGitProvider, path: string): Promise<string> {
  for (const key of ['github.user', 'user.username']) {
    try {
      const { stdout } = await provider.exec(['config', '--get', key], path)
      const name = normalizeGitUsername(stdout)
      if (isBranchSafeHostedLogin(name)) {
        return name
      }
    } catch {
      // An absent explicit hosted login leaves branch prefixing to the configured fallback.
    }
  }
  return ''
}

async function reuseSshBranch(args: {
  provider: SshGitProvider
  repoPath: string
  branch: string
  base: string
  explicit: boolean
}): Promise<boolean> {
  const { provider, repoPath, branch, base, explicit } = args
  const head = await sshCommitRef(provider, repoPath, `refs/heads/${branch}`)
  if (!head) {
    return false
  }
  const { stdout } = await provider.exec(
    ['for-each-ref', '--format=%(refname)', 'refs/heads/'],
    repoPath
  )
  const refs = stdout.split(/\r?\n/)
  if (explicit && !refs.includes(`refs/heads/${branch}`)) {
    throw new Error(
      `Branch "${branch}" resolves to a differently named ref. Select its exact branch name.`
    )
  }
  if (
    !explicit &&
    base.replace(/^refs\/heads\//, '') !== branch &&
    head !== (await sshCommitRef(provider, repoPath, base))
  ) {
    return false
  }
  const worktrees = await provider.listWorktrees(repoPath)
  const busy = worktrees.find((worktree) => {
    const current = worktree.branch.replace(/^refs\/heads\//, '')
    return (
      current === branch ||
      (explicit &&
        foldGitRefNameCase(current) === foldGitRefNameCase(branch) &&
        !refs.includes(`refs/heads/${current}`))
    )
  })
  if (busy && explicit) {
    throw new Error(
      `Branch "${branch}" is already checked out at "${busy.path}". Open that workspace, or turn off Reuse branch.`
    )
  }
  return !busy
}

export async function resolveSshWorktreeCreateCandidate(args: {
  request: RuntimeManagedWorktreeCreateArgs
  repo: Repo
  store: RuntimeStore
  settings: ReturnType<RuntimeStore['getSettings']>
  provider: SshGitProvider
  fs: IFilesystemProvider
  baseBranch: string
  remoteTrackingBase: RemoteTrackingBase | null
  pathClaim: WorktreeCreatePathClaim
}) {
  const { request, repo, store, settings, provider, fs } = args
  const sanitized = sanitizeWorktreeName(request.name)
  const exact = request.branchIntent === 'create-exact'
  const explicit = request.branchIntent === 'open-existing-v2'
  const username =
    !request.branchNameOverride && settings.branchPrefix === 'git-username'
      ? await sshGitUsername(provider, repo.path)
      : ''
  const branchPrefix =
    settings.branchPrefix === 'git-username' || settings.branchPrefix === 'custom'
      ? settings.branchPrefix
      : 'none'
  if (
    explicit &&
    (!request.branchNameOverride || request.pushTarget || getSelectedReviewBranch(request))
  ) {
    throw new Error(
      'Reuse branch requires an explicit branch selection without a review push target.'
    )
  }
  const retire = request.nameWasGenerated === true && isGeneratedWorktreeCreateName(sanitized)
  const retired =
    retire && hasRetiredNameRegistryStore(store)
      ? await getRetiredNameRegistryForRepo(store, repo, store.getRepos(), settings)
      : null
  const isRetired = retired ? createRetiredNameLookup(retired) : null
  let selectedBranch: string | undefined
  let conflict: 'local' | 'remote' | null = null
  for (let suffix = 1, attempts = 0; attempts < WORKTREE_CREATE_MAX_SUFFIX_ATTEMPTS; suffix++) {
    if (exact && suffix > 1) {
      throw exactNameTakenError(request.name)
    }
    const name = retire
      ? getGeneratedWorktreeCreateCandidate(sanitized, suffix, retired?.exhaustedTiers)
      : getWorktreeCreateCandidate(sanitized, suffix)
    if (isRetired?.(name)) {
      continue
    }
    attempts++
    const override =
      selectedBranch ??
      getBranchNameOverrideCandidate(request.branchNameOverride, explicit ? 1 : suffix)
    const branch =
      override ??
      computeValidatedBranchName(
        name,
        {
          branchPrefix,
          branchPrefixCustom: settings.branchPrefixCustom
        },
        username
      )
    if (branch.startsWith('-')) {
      throw new Error('Branch name must not start with "-"')
    }
    await provider.exec(['check-ref-format', '--branch', branch], repo.path)
    const run = (argv: string[], options?: { timeoutMs?: number }) =>
      provider.exec(argv, repo.path, options)
    const allowReuse = !exact && request.branchIntent !== 'create-new'
    const checkoutExistingBranch =
      allowReuse &&
      (await reuseSshBranch({
        provider,
        repoPath: repo.path,
        branch,
        base: args.baseBranch,
        explicit
      }))
    if (explicit && !checkoutExistingBranch && args.remoteTrackingBase?.branch !== branch) {
      throw new Error(
        `Branch "${branch}" was not found locally. Select its remote branch again, or turn off Reuse branch.`
      )
    }
    conflict = checkoutExistingBranch
      ? null
      : exact
        ? exactNameBranchConflict(await getBranchConflictKindStrictViaExec(run, branch), branch)
        : await getBranchConflictKindViaExec(run, branch, allowReuse ? args.baseBranch : undefined)
    if (conflict && !exact && isAllowedPushTargetRemoteConflict(conflict, branch, request)) {
      const review = await getSelectedHostedReviewForBranch(repo, branch, request).catch(() => null)
      if (review?.matchesSelected) {
        conflict = null
      }
    }
    if (conflict) {
      if (explicit) {
        throw new WorktreeCreateCollisionError(
          `Cannot reuse branch "${branch}" because its name conflicts with an existing branch.`
        )
      }
      continue
    }
    if (checkoutExistingBranch || explicit || request.branchIntent === 'open-existing') {
      selectedBranch = branch
    }
    const path = computeRemoteWorktreePath(
      name,
      repo.path,
      getWorktreePathSettings(repo, settings),
      { useConfiguredAbsolutePath: hasRepoWorktreeBasePath(repo) }
    )
    if (
      findPendingWorktreeRemovalConflict(repo.path, { worktreePath: path }) ||
      (await sshPathExists(fs, path)) ||
      !args.pathClaim.claim(`${getRepoExecutionHostId(repo)}::${path}`)
    ) {
      continue
    }
    const display = resolveWorktreeCreateDisplayNameRequest(
      request.displayName,
      request.displayNameKind,
      request.name,
      request.cliProvenance?.kind === 'created-by-cli',
      request.nameWasGenerated === true
    )
    return {
      branchName: branch,
      worktreePath: path,
      checkoutExistingBranch,
      effectiveSanitizedName: name,
      effectiveRequestedName: retire
        ? name
        : request.name.trim()
          ? getWorktreeCreateCandidate(request.name, suffix)
          : name,
      requestedDisplayName: display.value,
      displayNameKind: display.kind,
      retireGeneratedName: retire
    }
  }
  throw new WorktreeCreateCollisionError(
    conflict
      ? `Branch name already exists ${conflict === 'local' ? 'locally' : 'on a remote'}.`
      : `Could not find an available remote worktree path for "${sanitized}".`
  )
}
