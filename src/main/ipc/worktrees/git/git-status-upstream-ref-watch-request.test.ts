import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../../../persistence/loading-store/store'
import type { FsChangeEvent } from '../../../../shared/file-watch/filesystem-change-event'

const mocks = vi.hoisted(() => ({
  gitExec: vi.fn(),
  sshExec: vi.fn(),
  remoteWatch: vi.fn(),
  stopRemoteWatch: vi.fn(),
  resolveRegisteredPath: vi.fn(),
  getLocalRepo: vi.fn(),
  getLocalOptions: vi.fn(),
  setWatch: vi.fn(),
  isWslDistroRunning: vi.fn(async () => true)
}))
vi.mock('../../../wsl/discovery/wsl-background-distro-gate', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readWslDistroRunningState: async () =>
    (await mocks.isWslDistroRunning()) ? 'running' : 'stopped'
}))

vi.mock('../../../git/command-runner/git-exec-file', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  gitExecFileAsync: mocks.gitExec
}))
vi.mock('../removal/registered-worktree-roots-cache', () => ({
  resolveRegisteredWorktreePath: mocks.resolveRegisteredPath
}))
vi.mock('../../local-worktree-runtime-options', () => ({
  getLocalRepoForRegisteredWorktree: mocks.getLocalRepo,
  getLocalGitOptionsForRepo: mocks.getLocalOptions
}))
vi.mock('../creation/worktree-base-directory-watcher', () => ({
  setWorktreeGitStatusRefWatch: mocks.setWatch
}))
vi.mock('../../../providers/ssh-git-dispatch', () => ({
  requireSshGitProvider: () => ({ exec: mocks.sshExec }),
  getSshGitProviderGeneration: () => 7
}))
vi.mock('../../../providers/ssh-filesystem-dispatch', () => ({
  requireSshFilesystemProvider: () => ({ watch: mocks.remoteWatch })
}))

import { applyGitStatusUpstreamRefWatchRequest } from './git-status-upstream-ref-watch-request'
import { WslDistroStoppedError } from '../../../wsl/filesystem/wsl-unc-access-gate'

describe('applyGitStatusUpstreamRefWatchRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveRegisteredPath.mockResolvedValue('/resolved/repo')
    mocks.getLocalOptions.mockReturnValue({})
    mocks.setWatch.mockImplementation(
      async (_args: unknown, resolve: (signal: AbortSignal) => Promise<string | undefined>) =>
        resolve(new AbortController().signal)
    )
  })

  it('routes local exact resolution through the registered worktree runtime', async () => {
    mocks.getLocalOptions.mockReturnValue({ wslDistro: 'Ubuntu' })
    mocks.gitExec.mockResolvedValue({
      stdout: 'refs/heads/feature/main\0refs/remotes/origin/feature/main\0origin/feature/main\n'
    })

    await applyGitStatusUpstreamRefWatchRequest({} as Store, {
      worktreeId: 'repo-1::/repo',
      worktreePath: '/repo',
      executionHostId: 'wsl:Ubuntu',
      branch: 'refs/heads/feature/main',
      upstreamName: 'origin/feature/main'
    })

    expect(mocks.gitExec).toHaveBeenCalledWith(
      [
        'for-each-ref',
        '--format=%(refname)%00%(upstream)%00%(upstream:short)',
        '--count=1',
        'refs/heads/feature/main'
      ],
      expect.objectContaining({ cwd: '/resolved/repo', wslDistro: 'Ubuntu', timeout: 15_000 })
    )
  })

  it('resolves and watches the selected SSH upstream without local disk access', async () => {
    const controller = new AbortController()
    mocks.setWatch.mockImplementation(
      async (_args: unknown, resolve: (signal: AbortSignal) => Promise<string | undefined>) =>
        resolve(controller.signal)
    )
    mocks.sshExec
      .mockResolvedValueOnce({
        stdout:
          'refs/heads/feature/main\0refs/remotes/team/fork/feature/main\0team/fork/feature/main\n'
      })
      .mockResolvedValueOnce({ stdout: '.git\n' })
    mocks.remoteWatch.mockResolvedValue(mocks.stopRemoteWatch)
    const changed = vi.fn()
    await applyGitStatusUpstreamRefWatchRequest(
      {} as Store,
      {
        worktreeId: 'repo-1::/repo',
        worktreePath: '/repo',
        executionHostId: 'ssh:ssh-1',
        connectionId: 'ssh-1',
        branch: 'refs/heads/feature/main',
        upstreamName: 'team/fork/feature/main'
      },
      changed
    )
    expect(mocks.setWatch).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: 'ssh-1', providerGeneration: 7 }),
      expect.any(Function)
    )
    expect(mocks.remoteWatch).toHaveBeenCalledWith(
      '/repo/.git',
      expect.any(Function),
      expect.objectContaining({ signal: controller.signal })
    )
    const onEvents: (events: FsChangeEvent[]) => void = mocks.remoteWatch.mock.calls[0][1]
    onEvents([{ kind: 'update', absolutePath: '/repo/.git/objects/ab/unused' }])
    expect(changed).not.toHaveBeenCalled()
    onEvents([{ kind: 'update', absolutePath: '/repo/.git/refs/remotes/team/fork/feature/main' }])
    expect(changed).toHaveBeenCalledOnce()
    controller.abort()
    expect(mocks.stopRemoteWatch).toHaveBeenCalledOnce()
    expect(mocks.gitExec).not.toHaveBeenCalled()
    expect(mocks.resolveRegisteredPath).not.toHaveBeenCalled()
  })

  it('does not run Git in a stopped WSL distro (E9)', async () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    try {
      mocks.getLocalOptions.mockReturnValue({ wslDistro: 'Ubuntu' })
      mocks.isWslDistroRunning.mockResolvedValueOnce(false)
      await expect(
        applyGitStatusUpstreamRefWatchRequest({} as Store, {
          worktreeId: 'repo-1::/repo',
          worktreePath: '/repo',
          executionHostId: 'wsl:Ubuntu',
          branch: 'refs/heads/main',
          upstreamName: 'origin/main'
        })
      ).rejects.toBeInstanceOf(WslDistroStoppedError)
      expect(mocks.gitExec).not.toHaveBeenCalled()
    } finally {
      if (platform) {
        Object.defineProperty(process, 'platform', platform)
      }
    }
  })
})
