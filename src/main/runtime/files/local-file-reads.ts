import { open, stat } from 'node:fs/promises'
import type { RuntimeStore } from '../construction/runtime-store-contract'
import { MOBILE_FILE_READ_MAX_BYTES } from './file-preview-budget'
import { windowsFsPath } from '../../wsl/filesystem/wsl-unc-drive-fs-path'
import { resolveRuntimeAuthorizedPath } from './chat-scratch-file-root'
import {
  NodeFileReadTooLargeError,
  readNodeFileWithinLimit
} from '../../../shared/file-content/node-bounded-file-reader'
import { isBinaryBuffer } from '../../../shared/file-preview/binary-buffer'

export async function readPreviewBytes(
  filePath: string,
  maxBytes: number,
  options?: { regularFileOnly: true }
): Promise<Buffer> {
  try {
    return (await readNodeFileWithinLimit(filePath, maxBytes, options)).buffer
  } catch (error) {
    if (error instanceof NodeFileReadTooLargeError) {
      throw new Error('file_too_large')
    }
    throw error
  }
}

export async function readLocalMobileFile(filePath: string, store: RuntimeStore): Promise<string> {
  // Bound preview reads so large files cannot block the WebSocket.
  const { bytes } = await readLocalRuntimeFilePrefix(
    filePath,
    store,
    MOBILE_FILE_READ_MAX_BYTES + 1
  )
  // An extension the list does not know can still be binary; as text, a save would corrupt it.
  if (isBinaryBuffer(bytes)) {
    throw new Error('binary_file')
  }
  return bytes.toString('utf8')
}

export async function readLocalRuntimeFilePrefix(
  filePath: string,
  store: RuntimeStore,
  maxBytes: number
): Promise<{ bytes: Buffer; size: number }> {
  const authorizedPath = windowsFsPath(await resolveRuntimeAuthorizedPath(filePath, store))
  const fileStat = await stat(authorizedPath)
  const readLimit = Math.min(fileStat.size, maxBytes)
  const handle = await open(authorizedPath, 'r')
  try {
    const buffer = Buffer.alloc(readLimit)
    const { bytesRead } = await handle.read(buffer, 0, readLimit, 0)
    return { bytes: buffer.subarray(0, bytesRead), size: fileStat.size }
  } finally {
    await handle.close()
  }
}
