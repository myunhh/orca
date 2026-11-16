import { ipcMain } from 'electron'
import type { GitPushTarget } from '../../../../shared/worktree/types'
import { gitFastForward, gitPull, gitPush } from '../../../git/remotes/remote'
import { gitPullRebaseFromBase } from '../../../git/remotes/remote-rebase'
import { validateGitPushTarget } from '../../../git/remotes/push-target-validation'
import { resolveRegisteredWorktreePath } from '../../worktrees/removal/registered-worktree-roots-cache'
import { getLocalGitOptionsForRegisteredWorktree } from '../../local-worktree-runtime-options'
import { ipcGitWorktreeTarget, materializeWorktreePushTargetRemote } from '../../worktree-remote'
import type { FilesystemHandlerContext } from '../filesystem-handler-context'
import { requireReachableGitRoute } from '../../../providers/execution-host-provider-dispatch'
import { requireSshGitProvider } from '../../../providers/ssh-git-dispatch'
import { assertValidGitPushTarget } from '../../../../shared/git/remotes/git-push-target-validation'
import { materializeWorktreePushTargetRemoteSsh } from '../../worktree-remote'
import { getConnectionExecutionHostId } from '../../../../shared/execution-host'

export function registerGitRemoteBranchMutationHandlers(context: FilesystemHandlerContext): void {
  const { store } = context

  ipcMain.handle(
    'git:push',
    async (
      _event,
      args: {
        worktreePath: string
        worktreeId?: string
        publish?: boolean
        forceWithLease?: boolean
        connectionId?: string
        pushTarget?: GitPushTarget
      }
    ): Promise<void> => {
      // Require literal true so malformed values such as string false cannot enable --set-upstream.
      const publish = args.publish === true
      if (args.connectionId) {
        if (args.pushTarget) {
          assertValidGitPushTarget(args.pushTarget)
        }
        const provider = requireSshGitProvider(args.connectionId)
        const target = args.pushTarget
          ? await materializeWorktreePushTargetRemoteSsh(
              provider,
              args.worktreePath,
              args.pushTarget,
              store,
              undefined,
              ipcGitWorktreeTarget(args)
            )
          : undefined
        return provider.pushBranch(args.worktreePath, publish, target, {
          forceWithLease: args.forceWithLease === true
        })
      }
      requireReachableGitRoute(getConnectionExecutionHostId(args.connectionId))
      const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
      const gitOptions = getLocalGitOptionsForRegisteredWorktree(
        store,
        args.worktreePath,
        worktreePath
      )
      const materializedPushTarget = args.pushTarget
        ? await materializeWorktreePushTargetRemote(
            worktreePath,
            args.pushTarget,
            store,
            undefined,
            gitOptions,
            ipcGitWorktreeTarget(args)
          )
        : undefined
      if (materializedPushTarget) {
        await validateGitPushTarget(worktreePath, materializedPushTarget, {
          ...gitOptions,
          admissionTier: 'interactive'
        })
      }
      await gitPush(worktreePath, publish, materializedPushTarget, {
        forceWithLease: args.forceWithLease === true,
        ...gitOptions,
        admissionTier: 'interactive'
      })
    }
  )

  ipcMain.handle(
    'git:pull',
    async (
      _event,
      args: {
        worktreePath: string
        worktreeId?: string
        connectionId?: string
        pushTarget?: GitPushTarget
      }
    ): Promise<void> => {
      if (args.connectionId) {
        if (args.pushTarget) {
          assertValidGitPushTarget(args.pushTarget)
        }
        const provider = requireSshGitProvider(args.connectionId)
        const target = args.pushTarget
          ? await materializeWorktreePushTargetRemoteSsh(
              provider,
              args.worktreePath,
              args.pushTarget,
              store,
              undefined,
              ipcGitWorktreeTarget(args)
            )
          : undefined
        return provider.pullBranch(args.worktreePath, target)
      }
      requireReachableGitRoute(getConnectionExecutionHostId(args.connectionId))
      const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
      const gitOptions = getLocalGitOptionsForRegisteredWorktree(
        store,
        args.worktreePath,
        worktreePath
      )
      const materializedPushTarget = args.pushTarget
        ? await materializeWorktreePushTargetRemote(
            worktreePath,
            args.pushTarget,
            store,
            undefined,
            gitOptions,
            ipcGitWorktreeTarget(args)
          )
        : undefined
      if (materializedPushTarget) {
        await validateGitPushTarget(worktreePath, materializedPushTarget, {
          ...gitOptions,
          admissionTier: 'interactive'
        })
      }
      await gitPull(worktreePath, materializedPushTarget, {
        ...gitOptions,
        admissionTier: 'interactive'
      })
    }
  )

  ipcMain.handle(
    'git:fastForward',
    async (
      _event,
      args: {
        worktreePath: string
        worktreeId?: string
        connectionId?: string
        pushTarget?: GitPushTarget
      }
    ): Promise<void> => {
      if (args.connectionId) {
        if (args.pushTarget) {
          assertValidGitPushTarget(args.pushTarget)
        }
        const provider = requireSshGitProvider(args.connectionId)
        const target = args.pushTarget
          ? await materializeWorktreePushTargetRemoteSsh(
              provider,
              args.worktreePath,
              args.pushTarget,
              store,
              undefined,
              ipcGitWorktreeTarget(args)
            )
          : undefined
        return provider.fastForwardBranch(args.worktreePath, target)
      }
      requireReachableGitRoute(getConnectionExecutionHostId(args.connectionId))
      const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
      const gitOptions = getLocalGitOptionsForRegisteredWorktree(
        store,
        args.worktreePath,
        worktreePath
      )
      const materializedPushTarget = args.pushTarget
        ? await materializeWorktreePushTargetRemote(
            worktreePath,
            args.pushTarget,
            store,
            undefined,
            gitOptions,
            ipcGitWorktreeTarget(args)
          )
        : undefined
      if (materializedPushTarget) {
        await validateGitPushTarget(worktreePath, materializedPushTarget, {
          ...gitOptions,
          admissionTier: 'interactive'
        })
      }
      await gitFastForward(worktreePath, materializedPushTarget, {
        ...gitOptions,
        admissionTier: 'interactive'
      })
    }
  )

  ipcMain.handle(
    'git:rebaseFromBase',
    async (
      _event,
      args: { worktreePath: string; baseRef: string; connectionId?: string }
    ): Promise<void> => {
      if (args.connectionId) {
        return requireSshGitProvider(args.connectionId).rebaseFromBase(
          args.worktreePath,
          args.baseRef
        )
      }
      requireReachableGitRoute(getConnectionExecutionHostId(args.connectionId))
      const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
      const gitOptions = getLocalGitOptionsForRegisteredWorktree(
        store,
        args.worktreePath,
        worktreePath
      )
      await gitPullRebaseFromBase(worktreePath, args.baseRef, {
        ...gitOptions,
        admissionTier: 'interactive'
      })
    }
  )
}
