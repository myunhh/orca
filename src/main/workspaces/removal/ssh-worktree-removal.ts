import type { Repo } from '../../../shared/repo-types'
import type { GitPushTarget, GitWorktreeInfo } from '../../../shared/worktree/types'
import type { HostWorktreeTarget } from '../../../shared/worktree/host-qualified-identity'
import type { RemoveWorktreeResult } from '../../../shared/worktree/create-types'
import {
  ARCHIVE_HOOK_TIMEOUT_MS,
  type ArchiveHookRunResult
} from '../../../shared/worktree/archive-hook-removal-gate'
import { assertWorktreeUnlockedForRemoval } from '../../../shared/worktree/removal'
import { isWindowsAbsolutePathLike } from '../../../shared/cross-platform-path'
import type { RuntimeStore } from '../../runtime/construction/runtime-store-contract'
import { readSshWorktreeHooks } from '../../runtime/workspaces/creation/runtime-ssh-worktree-setup'
import { getEffectiveHooksFromConfig } from '../../workspace-hooks/effective-hook-config'
import { getSetupRunnerEnvVars } from '../../workspace-hooks/setup-hook-env-vars'
import { cleanupUnusedWorktreePushTargetRemoteSsh } from '../../ipc/worktree-remote'
import { getSshPtyProvider } from '../../ipc/pty/provider/registry'
import { runWorktreeChangeInvalidators } from '../../ipc/worktrees/listing/worktree-change-invalidators'
import { findRegisteredDeletableWorktree } from './worktree-removal-safety'
import { assertNestedWorktreeRemovalApproval } from './nested-worktree-removal-plan'
import {
  resolveWorktreeRemovalHome,
  type WorktreeRemovalRoute
} from './worktree-removal-execution-host-route'
import { gateWorktreeRemovalOnArchiveHook } from './worktree-archive-hook-gate'

export type SshWorktreeRemovalRoute = Extract<WorktreeRemovalRoute, { kind: 'ssh' }>

export async function removeRegisteredSshWorktree(args: {
  repo: Repo
  route: SshWorktreeRemovalRoute
  target: HostWorktreeTarget
  registeredWorktree: GitWorktreeInfo
  pushTarget?: GitPushTarget
  store: RuntimeStore
  force: boolean
  deleteBranch: boolean
  runHooks: boolean
  allowFailedArchiveHook: boolean
  acquireWatcherRemoval: (
    path: string,
    connectionId: string
  ) => Promise<{ finish: (removed: boolean) => Promise<void> }>
  stopPtys: () => Promise<void>
  finishRemoval: (result: RemoveWorktreeResult) => void | Promise<void>
}): Promise<RemoveWorktreeResult & { warning?: string }> {
  const { repo, route, registeredWorktree, target } = args
  const { provider, connectionId } = route
  const recheck = async () => {
    const rows = await provider.listWorktrees(repo.path)
    const current = findRegisteredDeletableWorktree(
      repo.path,
      registeredWorktree.path,
      rows,
      resolveWorktreeRemovalHome(route)
    )
    assertNestedWorktreeRemovalApproval(current ? [current] : [], [registeredWorktree])
    assertWorktreeUnlockedForRemoval(current ?? undefined)
  }
  await recheck()
  let warning: string | undefined
  let archiveHookOverride: RemoveWorktreeResult['archiveHookOverride']
  if (args.runHooks) {
    let result: ArchiveHookRunResult | undefined
    try {
      if (!route.fsProvider) {
        throw new Error(
          'SSH filesystem provider unavailable; archive hook configuration could not be verified.'
        )
      }
      const yaml = await readSshWorktreeHooks(route.fsProvider, repo.path)
      const script = getEffectiveHooksFromConfig(repo, yaml)?.scripts.archive
      if (script) {
        const windows = isWindowsAbsolutePathLike(registeredWorktree.path)
        const remote = await provider.execNonInteractive(
          windows ? 'cmd.exe' : '/bin/bash',
          windows ? ['/d', '/s', '/c', script] : ['-lc', script],
          registeredWorktree.path,
          ARCHIVE_HOOK_TIMEOUT_MS,
          undefined,
          getSetupRunnerEnvVars(repo, registeredWorktree.path, { worktreeId: target.id })
        )
        const observedExit =
          !remote.spawnError && !remote.timedOut && typeof remote.exitCode === 'number'
            ? remote.exitCode
            : undefined
        result = {
          success: observedExit === 0,
          output: [
            remote.stdout,
            remote.stderr,
            remote.spawnError,
            remote.timedOut ? 'archive hook timed out' : ''
          ]
            .filter(Boolean)
            .join('\n'),
          ...(observedExit === undefined ? {} : { exitCode: observedExit })
        }
      }
    } catch (error) {
      result = { success: false, output: error instanceof Error ? error.message : String(error) }
    }
    if (result) {
      archiveHookOverride = gateWorktreeRemovalOnArchiveHook({
        worktreePath: registeredWorktree.path,
        result,
        allowFailure: args.allowFailedArchiveHook
      })
    }
  } else {
    warning = `Archive hooks were skipped for ${registeredWorktree.path}.`
  }
  // Hooks can change HEAD or registration; deletion needs the originally approved checkout again.
  await recheck()
  if (!args.force) {
    const state = await provider.worktreeIsClean(registeredWorktree.path)
    if (!state.clean) {
      throw Object.assign(new Error('Worktree has uncommitted or untracked changes.'), {
        stdout: state.stdout
      })
    }
  }
  const gate = await args.acquireWatcherRemoval(registeredWorktree.path, connectionId)
  let completed = false
  let result: RemoveWorktreeResult
  try {
    await args.stopPtys()
    const removed = await provider.removeWorktree(registeredWorktree.path, args.force, {
      deleteBranch: args.deleteBranch
    })
    result =
      removed.preservedBranch && !removed.preservedBranch.head
        ? {
            ...removed,
            preservedBranch: { ...removed.preservedBranch, head: registeredWorktree.head }
          }
        : removed
    completed = true
    runWorktreeChangeInvalidators(repo.id)
  } finally {
    await gate.finish(completed)
  }
  await cleanupUnusedWorktreePushTargetRemoteSsh(
    provider,
    repo.path,
    target,
    args.pushTarget,
    args.store
  )
  try {
    await getSshPtyProvider(connectionId)?.deleteWorktreeHistory?.(target.id)
  } catch (error) {
    console.warn('[pty:history] remote removed-workspace history cleanup unavailable:', error)
  }
  await args.finishRemoval(result)
  return {
    ...result,
    ...(archiveHookOverride ? { archiveHookOverride } : {}),
    ...(warning ? { warning } : {})
  }
}
