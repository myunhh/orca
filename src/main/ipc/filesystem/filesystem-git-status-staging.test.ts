import type * as WorktreeScanCacheModule from '../../git/worktrees/catalog/worktree-scan-cache'
import type * as WorktreeListingModule from '../../git/worktrees/catalog/worktree-listing'
import type * as SshGitDispatchModule from '../../providers/ssh-git-dispatch'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  handlers,
  store,
  WORKTREE_FEATURE_PATH,
  discardChangesMock,
  getStatusMock,
  readFileMock,
  statMock,
  openMock,
  resetFilesystemIpcMocks
} from './filesystem-test-harness'
import type { GitStatusResult } from '../../../shared/git/status/git-status-types'

const remoteGit = vi.hoisted(() => ({
  getStatus: vi.fn(),
  bulkStageFiles: vi.fn()
}))
vi.mock('../../providers/ssh-git-dispatch', async (importOriginal) => {
  const actual = await importOriginal<typeof SshGitDispatchModule>()
  return {
    ...actual,
    requireSshGitProvider: (connectionId: string) =>
      connectionId === 'connected-ssh' ? remoteGit : actual.requireSshGitProvider(connectionId)
  }
})

vi.mock('../../git/worktrees/catalog/worktree-scan-cache', async (importOriginal) => {
  const { listWorktreesMock } = await import('./filesystem-test-harness')
  return {
    ...(await importOriginal<typeof WorktreeScanCacheModule>()),
    listWorktreeGraph: listWorktreesMock,
    listWorktrees: listWorktreesMock
  }
})

vi.mock('../../git/worktrees/catalog/worktree-listing', async (importOriginal) => {
  const { listWorktreesMock } = await import('./filesystem-test-harness')
  return {
    ...(await importOriginal<typeof WorktreeListingModule>()),
    listWorktreesStrict: listWorktreesMock
  }
})

vi.mock('electron', async () => (await import('./filesystem-test-harness')).electronMock)
vi.mock('fs/promises', async () => (await import('./filesystem-test-harness')).fsPromisesMock)
vi.mock(
  '../../wsl/filesystem/wsl-unc-delete',
  async () => (await import('./filesystem-test-harness')).wslUncDeleteMock
)
vi.mock(
  '../../crash-reporting/breadcrumbs/crash-breadcrumb-store',
  async () => (await import('./filesystem-test-harness')).crashBreadcrumbMock
)
vi.mock('../../git/source-control/commit-changes', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  commitChanges: (await import('./filesystem-test-harness')).commitChangesMock
}))

vi.mock('../../git/source-control/status-read', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getStatus: (await import('./filesystem-test-harness')).getStatusMock
}))

vi.mock('../../git/source-control/git-conflict-operation', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  detectConflictOperation: (await import('./filesystem-test-harness')).detectConflictOperationMock,
  abortMerge: (await import('./filesystem-test-harness')).abortMergeMock,
  abortRebase: (await import('./filesystem-test-harness')).abortRebaseMock
}))

vi.mock('../../git/source-control/file-diff', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getDiff: (await import('./filesystem-test-harness')).getDiffMock
}))

vi.mock('../../git/source-control/branch-compare', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getBranchCompare: (await import('./filesystem-test-harness')).getBranchCompareMock
}))

vi.mock('../../git/source-control/branch-diff', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getBranchDiff: (await import('./filesystem-test-harness')).getBranchDiffMock
}))

vi.mock('../../git/source-control/staged-commit-context', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getStagedCommitContext: (await import('./filesystem-test-harness')).getStagedCommitContextMock
}))

vi.mock('../../git/source-control/staging', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  stageFile: (await import('./filesystem-test-harness')).stageFileMock,
  bulkStageFiles: (await import('./filesystem-test-harness')).bulkStageFilesMock,
  stageWorktreeChanges: (await import('./filesystem-test-harness')).stageWorktreeChangesMock,
  unstageFile: (await import('./filesystem-test-harness')).unstageFileMock,
  bulkUnstageFiles: (await import('./filesystem-test-harness')).bulkUnstageFilesMock
}))

vi.mock('../../git/source-control/discard-changes', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  bulkDiscardChanges: (await import('./filesystem-test-harness')).bulkDiscardChangesMock,
  discardChanges: (await import('./filesystem-test-harness')).discardChangesMock
}))
vi.mock(
  '../../git/source-control/check-ignored-paths',
  async () => (await import('./filesystem-test-harness')).gitIgnoredPathsMock
)

vi.mock(
  '../../text-generation/commit-message-text-generation',
  async () => (await import('./filesystem-test-harness')).textGenerationModuleMock
)
vi.mock(
  '../../text-generation/pull-request-context',
  async () => (await import('./filesystem-test-harness')).pullRequestContextMock
)
vi.mock(
  '../../source-control/pull-request-template',
  async () => (await import('./filesystem-test-harness')).pullRequestTemplateMock
)
vi.mock(
  '../../source-control/pull-request-linked-issue',
  async () => (await import('./filesystem-test-harness')).pullRequestLinkedIssueMock
)

import { registerFilesystemHandlers } from './filesystem'
import { SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE } from '../../providers/ssh-git-dispatch'
import { invalidateAuthorizedRootsCache } from '../worktrees/removal/registered-worktree-roots-cache'

describe('registerFilesystemHandlers', () => {
  beforeEach(() => {
    resetFilesystemIpcMocks()
    // Drop cached roots between fixtures.
    invalidateAuthorizedRootsCache()
    remoteGit.getStatus.mockReset()
    remoteGit.bulkStageFiles.mockReset()
  })

  it('rejects git file paths that escape the selected worktree', async () => {
    registerFilesystemHandlers(store as never)

    await expect(
      handlers.get('git:discard')!(null, {
        worktreePath: WORKTREE_FEATURE_PATH,
        filePath: '../outside.txt'
      })
    ).rejects.toThrow('Access denied: git file path escapes the selected worktree')

    expect(discardChangesMock).not.toHaveBeenCalled()
  })

  it('reads status and stages scoped changes on the selected SSH host without local disk access', async () => {
    registerFilesystemHandlers(store as never)
    const remoteStatus: GitStatusResult = {
      branch: 'remote-feature',
      entries: [{ path: 'remote.ts', area: 'unstaged', status: 'modified' }],
      conflictOperation: 'unknown'
    }
    remoteGit.getStatus.mockResolvedValue(remoteStatus)
    await expect(
      handlers.get('git:status')!(null, {
        worktreePath: '/remote/repo',
        connectionId: 'connected-ssh',
        includeIgnored: true,
        includeLineStats: false,
        branchLineTotalMergeBase: 'a'.repeat(40)
      })
    ).resolves.toEqual(remoteStatus)
    expect(remoteGit.getStatus).toHaveBeenCalledWith(
      '/remote/repo',
      expect.objectContaining({
        includeIgnored: true,
        includeLineStats: false,
        branchLineTotalMergeBase: 'a'.repeat(40)
      })
    )
    await handlers.get('git:bulkStage')!(null, {
      worktreePath: '/remote/repo',
      connectionId: 'connected-ssh',
      filePaths: ['remote.ts'],
      scope: 'all'
    })
    expect(remoteGit.bulkStageFiles).toHaveBeenCalledWith('/remote/repo', ['remote.ts'], 'all')
    expect(getStatusMock).not.toHaveBeenCalled()
    expect(readFileMock).not.toHaveBeenCalled()
    expect(statMock).not.toHaveBeenCalled()
    expect(openMock).not.toHaveBeenCalled()
  })

  it('rejects unavailable direct SSH status and reads before any local access', async () => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the existing fixture supplies the store API exercised by these handlers.
    registerFilesystemHandlers(store as never)
    await expect(
      handlers.get('git:status')!(null, {
        worktreePath: WORKTREE_FEATURE_PATH,
        connectionId: 'ssh-unserved'
      })
    ).rejects.toThrow(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
    await expect(
      handlers.get('fs:readFile')!(null, {
        filePath: `${WORKTREE_FEATURE_PATH}/a.ts`,
        connectionId: 'ssh-unserved'
      })
    ).rejects.toThrow(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
    expect(getStatusMock).not.toHaveBeenCalled()
    expect(readFileMock).not.toHaveBeenCalled()
    expect(statMock).not.toHaveBeenCalled()
    expect(openMock).not.toHaveBeenCalled()
  })
})
