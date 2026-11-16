import type { Store } from '../../../persistence/loading-store/store'
import { resolveGitStatusUpstreamRef } from '../../../git/source-control/status-upstream-ref'
import { gitExecFileAsync } from '../../../git/command-runner/git-exec-file'
import { abortSignalWithTimeout } from '../../../lib/abort-signal-with-timeout'
import { resolveRegisteredWorktreePath } from '../removal/registered-worktree-roots-cache'
import {
  getLocalGitOptionsForRepo,
  getLocalRepoForRegisteredWorktree
} from '../../local-worktree-runtime-options'
import { setWorktreeGitStatusRefWatch } from '../creation/worktree-base-directory-watcher'
import type { GitStatusRefBindingRequest } from './worktree-git-status-ref-watch'
import { requireReachableGitRoute } from '../../../providers/execution-host-provider-dispatch'
import { getConnectionExecutionHostId } from '../../../../shared/execution-host'
import { assertWslUncPathRunning } from '../../../wsl/filesystem/wsl-unc-access-gate'
import {
  requireSshGitProvider,
  getSshGitProviderGeneration
} from '../../../providers/ssh-git-dispatch'
import { requireSshFilesystemProvider } from '../../../providers/ssh-filesystem-dispatch'
import {
  resolveRuntimePath,
  normalizeRuntimePathForComparison
} from '../../../../shared/cross-platform-path'

const UPSTREAM_REF_RESOLUTION_TIMEOUT_MS = 15_000

export function applyGitStatusUpstreamRefWatchRequest(
  store: Store,
  args: GitStatusRefBindingRequest,
  onRemoteRefChanged?: () => void
): Promise<void> {
  const providerGeneration = args.connectionId
    ? getSshGitProviderGeneration(args.connectionId)
    : undefined
  return setWorktreeGitStatusRefWatch(
    { ...args, ...(providerGeneration === undefined ? {} : { providerGeneration }) },
    async (bindingSignal) => {
      if (!args.branch || !args.upstreamName) {
        return undefined
      }
      const signal = abortSignalWithTimeout(bindingSignal, UPSTREAM_REF_RESOLUTION_TIMEOUT_MS)
      if (args.connectionId) {
        if (args.executionHostId !== getConnectionExecutionHostId(args.connectionId)) {
          throw new Error('Git status ref watch belongs to a different execution host.')
        }
        const provider = requireSshGitProvider(args.connectionId)
        const upstreamRef = await resolveGitStatusUpstreamRef(
          (gitArgs, cwd, requestSignal) =>
            provider.exec(gitArgs, cwd, {
              signal: requestSignal,
              timeoutMs: UPSTREAM_REF_RESOLUTION_TIMEOUT_MS
            }),
          args.worktreePath,
          args.branch,
          args.upstreamName,
          signal
        )
        if (upstreamRef && onRemoteRefChanged) {
          const commonDirResult = await provider.exec(
            ['rev-parse', '--git-common-dir'],
            args.worktreePath,
            { signal, timeoutMs: UPSTREAM_REF_RESOLUTION_TIMEOUT_MS }
          )
          const commonDir = resolveRuntimePath(args.worktreePath, commonDirResult.stdout.trim())
          const watchedPaths = new Set(
            [upstreamRef, 'packed-refs', 'config'].map((path) =>
              normalizeRuntimePathForComparison(resolveRuntimePath(commonDir, path))
            )
          )
          const stop = await requireSshFilesystemProvider(args.connectionId).watch(
            commonDir,
            (events) => {
              if (
                events.some(
                  (event) =>
                    event.kind === 'overflow' ||
                    watchedPaths.has(normalizeRuntimePathForComparison(event.absolutePath)) ||
                    (event.oldAbsolutePath !== undefined &&
                      watchedPaths.has(normalizeRuntimePathForComparison(event.oldAbsolutePath)))
                )
              ) {
                onRemoteRefChanged()
              }
            },
            { signal: bindingSignal, onTerminalError: onRemoteRefChanged }
          )
          if (bindingSignal.aborted) {
            stop()
          } else {
            bindingSignal.addEventListener('abort', stop, { once: true })
          }
        }
        return upstreamRef
      }
      requireReachableGitRoute(getConnectionExecutionHostId(args.connectionId))
      // Sent after each accepted status: its Git would boot a stopped WSL distro (E9).
      await assertWslUncPathRunning(args.worktreePath)

      const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
      const repo = getLocalRepoForRegisteredWorktree(store, args.worktreePath, worktreePath)
      const gitOptions = getLocalGitOptionsForRepo(store, repo)
      await assertWslUncPathRunning(worktreePath, gitOptions.wslDistro)
      return resolveGitStatusUpstreamRef(
        (gitArgs, cwd, requestSignal) =>
          gitExecFileAsync(gitArgs, {
            cwd,
            signal: requestSignal,
            timeout: UPSTREAM_REF_RESOLUTION_TIMEOUT_MS,
            ...(gitOptions.wslDistro ? { wslDistro: gitOptions.wslDistro } : {})
          }),
        worktreePath,
        args.branch,
        args.upstreamName,
        signal
      )
    }
  )
}
