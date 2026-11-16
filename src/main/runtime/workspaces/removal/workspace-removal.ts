import type { LocalProjectWorktreeGitOptions } from '../../../workspaces/execution-host/project-runtime-git-options'
import type { RuntimeStore } from '../../construction/runtime-store-contract'
import type { GitWorktreeInfo } from '../../../../shared/worktree/types'
import { RuntimeWorkspaceMetadata } from '../workspace-metadata'
import { resolveWorktreeRemovalRepoOwner } from '../../../workspaces/removal/worktree-removal-repo-owner'
import type { RemoveWorktreeResult } from '../../../../shared/worktree/create-types'
import {
  getRepoExecutionHostId,
  parseExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import { finishAcceptedWorktreeRemoval } from '../../../workspaces/removal/worktree-background-removal'
import { preservedBranchCleanupScopeKey } from '../../../../shared/git/branches/preserved-branch-cleanup'
import {
  getRuntimeWorktreeRemovalOptionsKey,
  type RemoveManagedWorktreeOptions,
  type RuntimeWorktreeRemovalTarget
} from '../catalog/runtime-worktree-selection'
import { withWorktreeSpan } from '../../../observability/instrumentation'
import { removeOrphanOrFolderWorktree } from './workspace-registration-removal'
import {
  assertWslMoveWorkspaceWritable,
  isWslMoveSourceHost
} from '../../../persistence/moving-wsl-projects/quiescence/wsl-move-scope-guard'
import { executeRuntimeWorktreeRemoval } from './runtime-worktree-removal-execution'

export abstract class OrcaRuntimeWithRemoveManagedWorktree extends RuntimeWorkspaceMetadata {
  abstract removeWorktreeMetadataAndHistory(
    store: RuntimeStore,
    worktreeId: string,
    hostId?: ExecutionHostId
  ): Promise<void>
  protected abstract resolveWorktreeRemovalTarget(
    worktreeSelector: string,
    requiredHostId?: ExecutionHostId
  ): Promise<RuntimeWorktreeRemovalTarget>
  protected abstract joinPendingWorktreeRemoval(
    worktreeId: string,
    options: RemoveManagedWorktreeOptions
  ): Promise<RemoveWorktreeResult> | undefined
  protected abstract purgeRemovedWorktree(
    store: RuntimeStore,
    worktreeId: string,
    repoId: string,
    removalHostId?: ExecutionHostId
  ): Promise<void>
  protected abstract retryFailedRemoval(
    route: { kind: string },
    target: { id: string; path: string },
    registeredWorktrees: readonly GitWorktreeInfo[],
    options: RemoveManagedWorktreeOptions,
    localOptions: LocalProjectWorktreeGitOptions
  ): Promise<boolean>

  async removeManagedWorktree(
    worktreeSelector: string,
    options: RemoveManagedWorktreeOptions = {}
  ): Promise<RemoveWorktreeResult & { warning?: string }> {
    const {
      force = false,
      runHooks = false,
      allowUnverifiedPtyStop = false,
      allowFailedArchiveHook = false,
      hostId
    } = options
    const store = this.requireStore()
    const cleanupHostId = parseExecutionHostId(hostId)?.id
    const removalTarget = await this.resolveWorktreeRemovalTarget(worktreeSelector, cleanupHostId)
    // The repo row names the host; a caller may omit hostId for a worktree on another host.
    const fenceOwner = resolveWorktreeRemovalRepoOwner(store, removalTarget.repoId, cleanupHostId)
    const fenceHostId =
      fenceOwner.kind === 'resolved' ? getRepoExecutionHostId(fenceOwner.repo) : cleanupHostId
    if (isWslMoveSourceHost(fenceHostId)) {
      assertWslMoveWorkspaceWritable(store, removalTarget.id)
    }
    // Why: a retry or a second client asking while Git still deletes joins that removal.
    const pending = this.joinPendingWorktreeRemoval(removalTarget.id, options)
    if (pending) {
      return options.waitForBackgroundRemoval ? await pending : { removing: true }
    }
    const emitRemoved = (): void =>
      this.emitWorktreeLifecycle({
        kind: 'removed',
        worktreeId: removalTarget.id,
        path: removalTarget.path
      })
    const cleanupScopeKey = preservedBranchCleanupScopeKey({
      worktreeId: removalTarget.id,
      hostId: cleanupHostId
    })
    const optionsKey = getRuntimeWorktreeRemovalOptionsKey({
      force,
      runHooks,
      allowUnverifiedPtyStop,
      allowFailedArchiveHook,
      deleteBranch: options.deleteBranch
    })
    const inFlightRemoval = this.removeManagedWorktreeInFlight.get(
      cleanupScopeKey,
      removalTarget.id,
      optionsKey
    )
    if (inFlightRemoval) {
      return options.waitForBackgroundRemoval
        ? finishAcceptedWorktreeRemoval(await inFlightRemoval, removalTarget.id, cleanupHostId)
        : inFlightRemoval
    }
    const removal = (async (): Promise<RemoveWorktreeResult & { warning?: string }> => {
      return withWorktreeSpan({ stage: 'remove', path: removalTarget.path }, async () => {
        const repoOwner = resolveWorktreeRemovalRepoOwner(
          store,
          removalTarget.repoId,
          cleanupHostId
        )
        if (repoOwner.kind === 'ambiguous') {
          throw new Error(
            `Workspace identity is ambiguous across hosts: ${removalTarget.id}. Retry with an explicit host.`
          )
        }
        const repo = repoOwner.kind === 'resolved' ? repoOwner.repo : undefined
        const removalHostId = repo ? (cleanupHostId ?? getRepoExecutionHostId(repo)) : cleanupHostId
        const purgeRemovedWorktree = (): Promise<void> =>
          this.purgeRemovedWorktree(store, removalTarget.id, removalTarget.repoId, removalHostId)
        const orphanOrFolderResult = await removeOrphanOrFolderWorktree({
          runtime: this,
          store,
          removalTarget,
          cleanupHostId,
          removalHostId,
          repo,
          archive: { runHooks, allowFailedArchiveHook }
        })
        if (orphanOrFolderResult) {
          return orphanOrFolderResult
        }
        return executeRuntimeWorktreeRemoval({
          repo: repo!,
          target: removalTarget,
          removalHostId: removalHostId!,
          cleanupHostId,
          store,
          options,
          preservedBranchCleanup: this.preservedBranchCleanup,
          ports: {
            acquireWatcherRemoval: this.acquireFileWatcherRemoval,
            stopPtys: this.stopPtysForDestructiveWorktreeRemoval.bind(this),
            retryFailedRemoval: this.retryFailedRemoval.bind(this),
            closeWatchers: (path) => this.closeFileWatchersForRemoval(path),
            purgeRemovedWorktree,
            notifyWorktreesChanged: this.notifyWorktreesChanged.bind(this),
            publish: (repoId) => this.publishWorktreeRemovalChange(repoId),
            onRemoved: emitRemoved
          }
        })
      })
    })()
    this.removeManagedWorktreeInFlight.track(cleanupScopeKey, optionsKey, removal)
    try {
      const accepted = await removal
      // A background removal emits this when Git finishes instead.
      if (!accepted.removing) {
        emitRemoved()
      }
      if (!options.waitForBackgroundRemoval) {
        return accepted
      }
      // oxlint-disable-next-line typescript/return-await -- the in-flight entry covers acceptance only, not the background wait
      return finishAcceptedWorktreeRemoval(accepted, removalTarget.id, cleanupHostId)
    } finally {
      this.removeManagedWorktreeInFlight.release(cleanupScopeKey, removal)
    }
  }
}
