import { randomUUID } from 'node:crypto'
import { isWindowsAbsolutePathLike } from '../../../shared/cross-platform-path'
import { deconflictCopyName } from '../../../shared/import-copy-name'
import type { ImportItemResult } from '../../../shared/file-import/filesystem-import-result'
import { missingOrIdenticalPrecondition } from '../../../shared/file-write/file-write-disk-precondition'
import { isConfirmedFileNotFoundError } from '../../../shared/file-write/file-write-disk-precondition'
import { assertSafeRemotePathSegment } from '../../ssh/remote-host/ssh-remote-platform'
import {
  getSshFilesystemProvider,
  requireSshFilesystemProvider
} from '../../providers/ssh-filesystem-dispatch'
import { joinWorktreeRelativePath } from '../../runtime/files/paths/runtime-relative-paths'
import { streamExternalFileSlices } from '../runtime-upload-file-stream'
import { REMOTE_IMPORT_MAX_FILE_BYTES } from '../runtime-import-limits'
import {
  stageOneSourceForRuntimeUpload,
  stagedRuntimeUploadByteLength
} from './filesystem-runtime-upload-staging'

export async function importExternalPathsSsh(
  sourcePaths: string[],
  destDir: string,
  connectionId: string,
  options: { ensureDir?: boolean; assertCurrent: () => void; signal?: AbortSignal }
): Promise<{ results: ImportItemResult[] }> {
  const provider = requireSshFilesystemProvider(connectionId)
  const assertCurrent = (): void => {
    options.signal?.throwIfAborted()
    options.assertCurrent()
    if (getSshFilesystemProvider(connectionId) !== provider) {
      throw new Error('SSH connection changed; reconnect and try again')
    }
  }
  const exists = async (path: string): Promise<boolean> => {
    assertCurrent()
    try {
      await provider.stat(path)
      return true
    } catch (error) {
      if (isConfirmedFileNotFoundError(error)) {
        return false
      }
      throw error
    }
  }
  if (!provider.commitUpload) {
    throw new Error('Safe file imports require a newer SSH relay')
  }
  if (options.ensureDir) {
    const parent = joinWorktreeRelativePath(destDir, '..')
    assertCurrent()
    await provider.createDir(parent)
    if (provider.writeFileWithDiskPrecondition) {
      const content = '*\n!.gitignore\n'
      assertCurrent()
      await provider.writeFileWithDiskPrecondition(
        joinWorktreeRelativePath(parent, '.gitignore'),
        content,
        missingOrIdenticalPrecondition(content)
      )
    }
    assertCurrent()
    await provider.createDir(destDir)
  }
  const results: ImportItemResult[] = []
  const reservedNames = new Set<string>()
  let totalBytes = 0
  const flavor = isWindowsAbsolutePathLike(destDir) ? 'windows' : 'posix'
  for (const sourcePath of sourcePaths) {
    const staged = await stageOneSourceForRuntimeUpload(sourcePath, totalBytes)
    if (staged.status !== 'staged') {
      results.push(staged)
      continue
    }
    totalBytes += stagedRuntimeUploadByteLength(staged)
    let tempPath: string | null = null
    try {
      assertSafeRemotePathSegment(staged.name, flavor)
      for (const entry of staged.entries) {
        for (const segment of entry.relativePath.split('/').filter(Boolean)) {
          assertSafeRemotePathSegment(segment, flavor)
        }
      }
      const name = await deconflictCopyName(
        staged.name,
        async (candidate) =>
          reservedNames.has(candidate) ||
          (await exists(joinWorktreeRelativePath(destDir, candidate)))
      )
      const finalPath = joinWorktreeRelativePath(destDir, name)
      tempPath = joinWorktreeRelativePath(destDir, `.orca-upload-${randomUUID()}`)
      assertCurrent()
      await (staged.kind === 'directory'
        ? provider.createDirNoClobber(tempPath)
        : provider.createFile(tempPath))
      for (const entry of staged.entries) {
        assertCurrent()
        const target = entry.relativePath
          ? joinWorktreeRelativePath(tempPath, entry.relativePath)
          : tempPath
        if (entry.kind === 'directory') {
          if (entry.relativePath) {
            await provider.createDirNoClobber(target)
          }
          continue
        }
        if (entry.relativePath) {
          await provider.createFile(target)
        }
        await streamExternalFileSlices({
          sourceRootPath: sourcePath,
          entryRelativePath: entry.relativePath,
          expected: entry,
          signal: options.signal,
          maxFileBytes: REMOTE_IMPORT_MAX_FILE_BYTES,
          limitLabel: 'per-file remote import limit',
          writeSlice: async (base64) => {
            assertCurrent()
            await provider.writeFileBase64Chunk(target, base64, true)
          }
        })
      }
      assertCurrent()
      await (staged.kind === 'directory'
        ? provider.renameNoClobber(tempPath, finalPath)
        : provider.commitUpload(tempPath, finalPath))
      tempPath = null
      reservedNames.add(name)
      results.push({
        sourcePath,
        status: 'imported',
        destPath: finalPath,
        kind: staged.kind,
        renamed: name !== staged.name
      })
    } catch (error) {
      results.push({
        sourcePath,
        status: 'failed',
        reason: error instanceof Error ? error.message : String(error)
      })
    } finally {
      if (tempPath && getSshFilesystemProvider(connectionId) === provider) {
        try {
          options.assertCurrent()
          await provider.deletePath(tempPath, true)
        } catch (error) {
          console.warn('[ssh-fs] failed to remove import staging path:', error)
        }
      }
    }
  }
  return { results }
}
