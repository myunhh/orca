import { constants, copyFile, mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { FileBytesWritePrecondition } from '../../../shared/file-write/file-bytes-write'
import type { FileWriteResult } from '../../../shared/file-write/file-write-disk-precondition'
import type { RuntimeFileCommandHost } from './file-command-host'
import { assertRuntimeFileMutationExpectation } from './file-mutation-expectation'
import {
  requireRuntimeFileProvider,
  resolveFileExplorerPaths,
  runtimeFileRouteForTarget
} from './file-target'
import { resolveRuntimeAuthorizedPath } from './chat-scratch-file-root'
import { replaceLocalFileBytesIfUnchanged } from '../../ipc/filesystem/local-disk-bytes-replace'

export class RuntimeFileUploadMutations {
  constructor(
    protected readonly host: Pick<
      RuntimeFileCommandHost,
      'requireStore' | 'resolveRuntimeFileTarget'
    >
  ) {}

  async commitFileExplorerUpload(
    worktreeSelector: string,
    tempRelativePath: string,
    finalRelativePath: string,
    expectedSshConnectionGeneration?: number,
    expectedSshTargetId?: string,
    expectedExecutionHostId?: string
  ): Promise<{ ok: true }> {
    const [tempTarget, finalTarget] = await resolveFileExplorerPaths(this.host, worktreeSelector, [
      tempRelativePath,
      finalRelativePath
    ])
    assertRuntimeFileMutationExpectation(
      tempTarget.executionHostId,
      expectedExecutionHostId,
      expectedSshTargetId,
      expectedSshConnectionGeneration
    )
    if (runtimeFileRouteForTarget(tempTarget).kind === 'ssh') {
      const provider = requireRuntimeFileProvider(tempTarget, this.host)
      if (!('commitUpload' in provider) || !provider.commitUpload) {
        throw new Error('Safe upload commits require a newer SSH relay')
      }
      await provider.commitUpload(tempTarget.path, finalTarget.path)
      return { ok: true }
    }
    // Commit resolved temp/final paths, not symlink-preserving spellings.
    const store = this.host.requireStore()
    const tempPath = await resolveRuntimeAuthorizedPath(tempTarget.path, store)
    const finalPath = await resolveRuntimeAuthorizedPath(finalTarget.path, store)
    await mkdir(dirname(finalPath), { recursive: true })
    await copyFile(tempPath, finalPath, constants.COPYFILE_EXCL)
    await rm(tempPath, { force: true })
    return { ok: true }
  }

  /** Atomically replaces a file with an uploaded temp file unless its bytes changed meanwhile. */
  async replaceFileExplorerFileWithUpload(
    worktreeSelector: string,
    tempRelativePath: string,
    finalRelativePath: string,
    precondition: FileBytesWritePrecondition,
    expectedSshConnectionGeneration?: number,
    expectedSshTargetId?: string,
    expectedExecutionHostId?: string
  ): Promise<FileWriteResult> {
    const [tempTarget, finalTarget] = await resolveFileExplorerPaths(this.host, worktreeSelector, [
      tempRelativePath,
      finalRelativePath
    ])
    assertRuntimeFileMutationExpectation(
      tempTarget.executionHostId,
      expectedExecutionHostId,
      expectedSshTargetId,
      expectedSshConnectionGeneration
    )
    if (runtimeFileRouteForTarget(tempTarget).kind === 'ssh') {
      const provider = requireRuntimeFileProvider(tempTarget, this.host)
      if (!('replaceWithUpload' in provider) || !provider.replaceWithUpload) {
        throw new Error('Safe upload replacement requires a newer SSH relay')
      }
      return provider.replaceWithUpload(tempTarget.path, finalTarget.path, precondition)
    }
    const store = this.host.requireStore()
    const tempPath = await resolveRuntimeAuthorizedPath(tempTarget.path, store)
    const finalPath = await resolveRuntimeAuthorizedPath(finalTarget.path, store)
    try {
      return await replaceLocalFileBytesIfUnchanged(
        finalPath,
        (replacement) => copyFile(tempPath, replacement),
        precondition
      )
    } finally {
      await rm(tempPath, { force: true })
    }
  }
}
