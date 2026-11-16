import { randomUUID } from 'node:crypto'
import type { IFilesystemProvider } from '../../providers/filesystem-provider-contract'
import type { FileBytesWritePrecondition } from '../../../shared/file-write/file-bytes-write'
import type { FileWriteResult } from '../../../shared/file-write/file-write-disk-precondition'
import { joinWorktreeRelativePath } from '../../runtime/files/paths/runtime-relative-paths'

export async function replaceSshFileBytesIfUnchanged(
  provider: IFilesystemProvider,
  filePath: string,
  bytes: Uint8Array,
  precondition: FileBytesWritePrecondition
): Promise<FileWriteResult> {
  if (!provider.replaceWithUpload) {
    throw new Error('Safe binary file writes require a newer SSH relay')
  }
  const tempPath = joinWorktreeRelativePath(filePath, `../.orca-upload-${randomUUID()}`)
  await provider.createFile(tempPath)
  try {
    const content = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    for (let offset = 0; offset < content.length; offset += 512 * 1024) {
      await provider.writeFileBase64Chunk(
        tempPath,
        content.subarray(offset, offset + 512 * 1024).toString('base64'),
        true
      )
    }
    return await provider.replaceWithUpload(tempPath, filePath, precondition)
  } finally {
    await provider.deletePath(tempPath).catch((error) => {
      console.warn('[ssh-fs] failed to remove upload staging file:', error)
    })
  }
}
