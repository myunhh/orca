import { assertRuntimeFileMutationExpectation } from './file-mutation-expectation'
import { formatEditorText } from '../../editor/format-editor-text'
import {
  requireRuntimeFileProvider,
  resolveFileExplorerPath,
  resolveFileExplorerPaths,
  runtimeFileRouteForTarget
} from './file-target'
import type {
  FileWriteDiskPrecondition,
  FileWriteResult
} from '../../../shared/file-write/file-write-disk-precondition'
import { RuntimeFileUploadMutations } from './file-upload-mutations'

export class RuntimeFileMutations extends RuntimeFileUploadMutations {
  async formatFileExplorerText(
    worktreeSelector: string,
    relativePath: string,
    text: string,
    expectedSshConnectionGeneration?: number,
    expectedSshTargetId?: string,
    expectedExecutionHostId?: string
  ) {
    const target = await resolveFileExplorerPath(this.host, worktreeSelector, relativePath)
    assertRuntimeFileMutationExpectation(
      target.executionHostId,
      expectedExecutionHostId,
      expectedSshTargetId,
      expectedSshConnectionGeneration
    )
    return formatEditorText(this.host.requireStore(), target, text, () => {
      if (runtimeFileRouteForTarget(target).kind !== 'local') {
        throw new Error('Format on Save does not support SSH-hosted files yet.')
      }
    })
  }

  async writeFileExplorerFile(
    worktreeSelector: string,
    relativePath: string,
    content: string,
    expectedSshConnectionGeneration?: number,
    expectedSshTargetId?: string,
    expectedExecutionHostId?: string,
    diskPrecondition?: FileWriteDiskPrecondition
  ): Promise<FileWriteResult> {
    const target = await resolveFileExplorerPath(this.host, worktreeSelector, relativePath)
    assertRuntimeFileMutationExpectation(
      target.executionHostId,
      expectedExecutionHostId,
      expectedSshTargetId,
      expectedSshConnectionGeneration
    )
    const provider = requireRuntimeFileProvider(target, this.host)
    if (!provider.writeFileWithDiskPrecondition) {
      throw new Error('Safe file writes require a newer SSH relay')
    }
    return provider.writeFileWithDiskPrecondition(target.path, content, diskPrecondition)
  }

  async writeFileExplorerFileBase64(
    worktreeSelector: string,
    relativePath: string,
    contentBase64: string,
    expectedSshConnectionGeneration?: number,
    expectedSshTargetId?: string,
    expectedExecutionHostId?: string
  ): Promise<{ ok: true }> {
    const target = await resolveFileExplorerPath(this.host, worktreeSelector, relativePath)
    assertRuntimeFileMutationExpectation(
      target.executionHostId,
      expectedExecutionHostId,
      expectedSshTargetId,
      expectedSshConnectionGeneration
    )
    await requireRuntimeFileProvider(target, this.host).writeFileBase64(target.path, contentBase64)
    return { ok: true }
  }

  async writeFileExplorerFileBase64Chunk(
    worktreeSelector: string,
    relativePath: string,
    contentBase64: string,
    append: boolean,
    expectedSshConnectionGeneration?: number,
    expectedSshTargetId?: string,
    expectedExecutionHostId?: string
  ): Promise<{ ok: true }> {
    const target = await resolveFileExplorerPath(this.host, worktreeSelector, relativePath)
    assertRuntimeFileMutationExpectation(
      target.executionHostId,
      expectedExecutionHostId,
      expectedSshTargetId,
      expectedSshConnectionGeneration
    )
    await requireRuntimeFileProvider(target, this.host).writeFileBase64Chunk(
      target.path,
      contentBase64,
      append
    )
    return { ok: true }
  }

  async createFileExplorerFile(
    worktreeSelector: string,
    relativePath: string,
    expectedSshConnectionGeneration?: number,
    expectedSshTargetId?: string,
    expectedExecutionHostId?: string
  ): Promise<{ ok: true }> {
    const target = await resolveFileExplorerPath(this.host, worktreeSelector, relativePath)
    assertRuntimeFileMutationExpectation(
      target.executionHostId,
      expectedExecutionHostId,
      expectedSshTargetId,
      expectedSshConnectionGeneration
    )
    await requireRuntimeFileProvider(target, this.host).createFile(target.path)
    return { ok: true }
  }

  async createFileExplorerDir(
    worktreeSelector: string,
    relativePath: string,
    expectedSshConnectionGeneration?: number,
    expectedSshTargetId?: string,
    expectedExecutionHostId?: string
  ): Promise<{ ok: true }> {
    const target = await resolveFileExplorerPath(this.host, worktreeSelector, relativePath)
    assertRuntimeFileMutationExpectation(
      target.executionHostId,
      expectedExecutionHostId,
      expectedSshTargetId,
      expectedSshConnectionGeneration
    )
    await requireRuntimeFileProvider(target, this.host).createDir(target.path)
    return { ok: true }
  }

  async createFileExplorerDirNoClobber(
    worktreeSelector: string,
    relativePath: string,
    expectedSshConnectionGeneration?: number,
    expectedSshTargetId?: string,
    expectedExecutionHostId?: string
  ): Promise<{ ok: true }> {
    const target = await resolveFileExplorerPath(this.host, worktreeSelector, relativePath)
    assertRuntimeFileMutationExpectation(
      target.executionHostId,
      expectedExecutionHostId,
      expectedSshTargetId,
      expectedSshConnectionGeneration
    )
    await requireRuntimeFileProvider(target, this.host).createDirNoClobber(target.path)
    return { ok: true }
  }

  async renameFileExplorerPath(
    worktreeSelector: string,
    oldRelativePath: string,
    newRelativePath: string,
    expectedSshConnectionGeneration?: number,
    expectedSshTargetId?: string,
    expectedExecutionHostId?: string
  ): Promise<{ ok: true }> {
    const [oldTarget, newTarget] = await resolveFileExplorerPaths(this.host, worktreeSelector, [
      oldRelativePath,
      newRelativePath
    ])
    assertRuntimeFileMutationExpectation(
      oldTarget.executionHostId,
      expectedExecutionHostId,
      expectedSshTargetId,
      expectedSshConnectionGeneration
    )
    await requireRuntimeFileProvider(oldTarget, this.host).renameNoClobber(
      oldTarget.path,
      newTarget.path
    )
    return { ok: true }
  }

  async copyFileExplorerPath(
    worktreeSelector: string,
    sourceRelativePath: string,
    destinationRelativePath: string,
    expectedSshConnectionGeneration?: number,
    expectedSshTargetId?: string,
    expectedExecutionHostId?: string
  ): Promise<{ ok: true }> {
    const [sourceTarget, destinationTarget] = await resolveFileExplorerPaths(
      this.host,
      worktreeSelector,
      [sourceRelativePath, destinationRelativePath]
    )
    assertRuntimeFileMutationExpectation(
      sourceTarget.executionHostId,
      expectedExecutionHostId,
      expectedSshTargetId,
      expectedSshConnectionGeneration
    )
    await requireRuntimeFileProvider(sourceTarget, this.host).copy(
      sourceTarget.path,
      destinationTarget.path
    )
    return { ok: true }
  }

  async deleteFileExplorerPath(
    worktreeSelector: string,
    relativePath: string,
    recursive?: boolean,
    expectedSshConnectionGeneration?: number,
    expectedSshTargetId?: string,
    expectedExecutionHostId?: string
  ): Promise<{ ok: true }> {
    const target = await resolveFileExplorerPath(this.host, worktreeSelector, relativePath)
    assertRuntimeFileMutationExpectation(
      target.executionHostId,
      expectedExecutionHostId,
      expectedSshTargetId,
      expectedSshConnectionGeneration
    )
    // Remote runtimes have no client Trash; callers confirm this permanent delete.
    await requireRuntimeFileProvider(target, this.host).deletePath(target.path, recursive)
    return { ok: true }
  }
}
