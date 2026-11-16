import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { toLocalBaseRefRefreshResult } from '../../../../shared/worktree/local-base-branch-fast-forward'
import { requireSshGitProvider } from '../../../providers/ssh-git-dispatch'
import { requireSshFilesystemProvider } from '../../../providers/ssh-filesystem-dispatch'
import { findCreatedWorktree } from '../../../ipc/created-worktree-reconciliation'
import { normalizeSparseDirectories } from '../../../ipc/sparse-checkout-directories'
import { configureCreatedWorktreePushTargetWithExec } from '../../../git/remotes/worktree-push-target-setup'
import type { AddWorktreeResult } from '../../../git/worktrees/worktree-operation-options'
import {
  getEffectiveHooksFromConfig,
  shouldRunSetupForCreate
} from '../../../workspace-hooks/effective-hook-config'
import { openWorktreeCreatePathClaim } from '../../../workspaces/creation/worktree-create-in-flight'
import { exactNameLateCollision } from '../../../workspaces/creation/worktree-create-exact-name'
import { retireGeneratedWorktreeName } from '../../../workspaces/removal/retirement/worktree-name-retirement'
import { runWorktreeChangeInvalidators } from '../../../ipc/worktrees/listing/worktree-change-invalidators'
import type { WorktreeCreateTimingRecorder } from '../../../workspaces/creation/worktree-create-timing'
import type { RuntimeStore } from '../../construction/runtime-store-contract'
import type { RuntimeManagedWorktreeCreateArgs } from './runtime-managed-worktree-create-types'
import { resolveRuntimeSetupDecision } from './runtime-local-worktree-setup'
import { persistRuntimeCreatedWorktree } from './runtime-local-worktree-materialization'
import { resolveSshWorktreeCreateBase } from './runtime-ssh-worktree-create-base'
import {
  resolveSshWorktreeCreateCandidate,
  sshPathExists
} from './runtime-ssh-worktree-create-candidate'
import { readSshWorktreeHooks } from './runtime-ssh-worktree-setup'
import { registerSshWorktreeCreateRoots } from './runtime-ssh-worktree-roots'
import { WorktreeCreateSetupChoiceRefusedError } from './worktree-create-setup-choice-refusal'

function canRetireWorktreeName(store: RuntimeStore): store is RuntimeStore & {
  addRetiredWorktreeName: NonNullable<RuntimeStore['addRetiredWorktreeName']>
} {
  return typeof store.addRetiredWorktreeName === 'function'
}

export async function createRuntimeSshManagedWorktree<T>(args: {
  request: RuntimeManagedWorktreeCreateArgs
  repo: Repo
  connectionId: string
  store: RuntimeStore
  onWorktreeMetadataPersisted: (worktree: Worktree) => T
  timing: WorktreeCreateTimingRecorder
}) {
  const { request, repo, connectionId, store, timing } = args
  const provider = requireSshGitProvider(connectionId)
  const fs = requireSshFilesystemProvider(connectionId)
  const hostSettings = store.getSettings()
  const settings = {
    ...hostSettings,
    nestWorkspaces: request.nestWorkspaces ?? hostSettings.nestWorkspaces,
    refreshLocalBaseRefOnWorktreeCreate:
      request.refreshLocalBaseRefOnWorktreeCreate ??
      hostSettings.refreshLocalBaseRefOnWorktreeCreate,
    localBaseRefSuggestionDismissed:
      request.localBaseRefSuggestionDismissed ?? hostSettings.localBaseRefSuggestionDismissed
  }
  timing.recordExecutionHost('ssh')
  await registerSshWorktreeCreateRoots(connectionId, [repo.path])
  const primaryHooks = getEffectiveHooksFromConfig(repo, await readSshWorktreeHooks(fs, repo.path))
  if (primaryHooks?.scripts.setup) {
    try {
      shouldRunSetupForCreate(repo, resolveRuntimeSetupDecision(request))
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'Setup decision required for this repository'
      ) {
        throw new WorktreeCreateSetupChoiceRefusedError(error.message, { cause: error })
      }
      throw error
    }
  }
  const base = await resolveSshWorktreeCreateBase({
    provider,
    repo,
    requestedBaseBranch: request.baseBranch,
    allowLocalBaseFallback: request.allowLocalBaseFallback,
    timing
  })
  const pathClaim = openWorktreeCreatePathClaim()
  try {
    const candidate = await timing.time('resolve_name', () =>
      resolveSshWorktreeCreateCandidate({
        request,
        repo,
        store,
        settings,
        provider,
        fs,
        baseBranch: base.baseBranch,
        remoteTrackingBase: base.remoteTrackingBase,
        pathClaim
      })
    )
    const { worktreePath, branchName, checkoutExistingBranch } = candidate
    const sparseDirectories = request.sparseCheckout
      ? normalizeSparseDirectories(request.sparseCheckout.directories)
      : []
    if (request.sparseCheckout && sparseDirectories.length === 0) {
      throw new Error('Sparse checkout requires at least one repo-relative directory.')
    }
    await registerSshWorktreeCreateRoots(connectionId, [worktreePath])
    const addResult: AddWorktreeResult = {}
    const tracking = base.remoteTrackingBase
    const refresh =
      settings.refreshLocalBaseRefOnWorktreeCreate &&
      !checkoutExistingBranch &&
      tracking &&
      tracking.branch !== branchName
        ? provider
            .refreshLocalBaseRefForWorktreeCreate({
              repoPath: repo.path,
              fullRef: `refs/heads/${tracking.branch}`,
              remoteTrackingRef: tracking.ref
            })
            .then((outcome) =>
              toLocalBaseRefRefreshResult(
                { baseRef: tracking.base, localBranch: tracking.branch },
                outcome
              )
            )
            .catch((error: unknown) => {
              console.warn('[worktree-create] remote local base refresh outcome unverified:', error)
              return undefined
            })
        : undefined
    if (
      !settings.refreshLocalBaseRefOnWorktreeCreate &&
      !settings.localBaseRefSuggestionDismissed &&
      !checkoutExistingBranch &&
      tracking
    ) {
      try {
        const behind = await provider.getLocalBaseRefFastForwardableBehind({
          repoPath: repo.path,
          fullRef: `refs/heads/${tracking.branch}`,
          remoteTrackingRef: tracking.ref
        })
        if (behind !== undefined) {
          addResult.localBaseRefUpdateSuggestion = {
            baseRef: tracking.base,
            localBranch: tracking.branch,
            behind
          }
        }
      } catch {
        // A read-only update suggestion cannot block a checkout.
      }
    }
    try {
      await timing.time('git_worktree_add', () =>
        provider.addWorktree(repo.path, branchName, worktreePath, {
          ...(checkoutExistingBranch
            ? { checkoutExistingBranch: true }
            : { base: tracking?.ref ?? base.baseBranch }),
          ...(sparseDirectories.length ? { noCheckout: true } : {})
        })
      )
    } catch (error) {
      if (request.branchIntent === 'create-exact') {
        throw await exactNameLateCollision(error, {
          branchName,
          worktreePath,
          pathExists: (path) => sshPathExists(fs, path)
        })
      }
      throw error
    } finally {
      addResult.localBaseRefRefresh = await refresh
    }
    runWorktreeChangeInvalidators(repo.id)
    if (sparseDirectories.length) {
      try {
        await provider.exec(['sparse-checkout', 'init', '--cone'], worktreePath)
        await provider.exec(['sparse-checkout', 'set', '--', ...sparseDirectories], worktreePath)
        await provider.exec(['checkout', branchName], worktreePath)
      } catch (error) {
        try {
          await provider.removeWorktree(worktreePath, true, {
            deleteBranch: !checkoutExistingBranch,
            forceBranchDelete: !checkoutExistingBranch
          })
        } catch (cleanupError) {
          if (candidate.retireGeneratedName && canRetireWorktreeName(store)) {
            await retireGeneratedWorktreeName(
              store,
              repo,
              settings,
              candidate.effectiveSanitizedName
            )
          }
          console.warn(
            '[worktree-create] failed to roll back remote sparse checkout:',
            cleanupError
          )
        }
        throw error
      }
    }
    if (candidate.retireGeneratedName && canRetireWorktreeName(store)) {
      await retireGeneratedWorktreeName(store, repo, settings, candidate.effectiveSanitizedName)
    }
    if (request.branchIntent === 'open-existing-v2' && !checkoutExistingBranch && tracking) {
      try {
        await provider.exec(['branch', '--set-upstream-to', tracking.ref, branchName], worktreePath)
      } catch (error) {
        addResult.upstreamWarning = `Created branch "${branchName}" but could not set its remote upstream.`
        console.warn('[worktree-create] SSH upstream setup failed:', error)
      }
    }
    const listing = await timing.time('list_created_worktree', () =>
      provider.listWorktrees(repo.path)
    )
    const created = findCreatedWorktree(listing, worktreePath, branchName)
    if (!created) {
      throw new Error('Worktree created but not found in the SSH host listing')
    }
    const configuredPushTarget =
      request.pushTarget && !request.pushTarget.remoteUrl
        ? await configureCreatedWorktreePushTargetWithExec(
            (argv, cwd) => provider.exec(argv, cwd),
            created.path,
            branchName,
            request.pushTarget
          )
        : request.pushTarget
    const materialized = persistRuntimeCreatedWorktree({
      request,
      repo,
      store,
      settings,
      created,
      remoteTrackingBase: tracking,
      sparseDirectories,
      configuredPushTarget,
      checkoutExistingBranch,
      baseBranch: base.baseBranch,
      branchName,
      effectiveRequestedName: candidate.effectiveRequestedName,
      requestedDisplayName: candidate.requestedDisplayName,
      displayNameKind: candidate.displayNameKind,
      effectiveSanitizedName: candidate.effectiveSanitizedName,
      effectiveCreatedWithAgent: request.createdWithAgent,
      creationSource: 'ssh',
      onMetadataPersisted: args.onWorktreeMetadataPersisted,
      timing
    })
    return {
      ...materialized,
      created,
      worktreePath,
      addResult,
      includeCopyWarning: undefined,
      ...(base.baseFallback ? { baseFallback: base.baseFallback } : {})
    }
  } finally {
    pathClaim.release()
  }
}
