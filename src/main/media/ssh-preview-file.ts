import { MAX_FILE_RANGE_READ_BYTES } from '../../shared/file-content/file-range-read'
import type { IFilesystemProvider } from '../providers/filesystem-provider-contract'
import {
  getSshFilesystemProvider,
  requireSshFilesystemProvider
} from '../providers/ssh-filesystem-dispatch'

export type SshPreviewFile = {
  connectionId: string
  provider: IFilesystemProvider
  path: string
  size: number
  identity: string
}
function statIdentity(info: Awaited<ReturnType<IFilesystemProvider['stat']>>): string {
  return JSON.stringify([
    info.type,
    info.size,
    info.mtimeMs ?? info.mtime,
    info.ctimeMs,
    info.dev,
    info.ino
  ])
}
export async function captureSshPreviewFile(
  connectionId: string,
  filePath: string
): Promise<SshPreviewFile> {
  const provider = requireSshFilesystemProvider(connectionId)
  if (!provider.readFileRange) {
    throw new Error('File previews require a newer SSH relay')
  }
  const path = await provider.realpath(filePath)
  const info = await provider.stat(path)
  if (info.type !== 'file' || !Number.isSafeInteger(info.size) || info.size < 0) {
    throw new Error('Preview requires a regular file')
  }
  if (getSshFilesystemProvider(connectionId) !== provider) {
    throw new Error('SSH preview connection changed')
  }
  return { connectionId, provider, path, size: info.size, identity: statIdentity(info) }
}
export async function assertSshPreviewFileCurrent(file: SshPreviewFile): Promise<void> {
  if (
    getSshFilesystemProvider(file.connectionId) !== file.provider ||
    (await file.provider.realpath(file.path)) !== file.path ||
    statIdentity(await file.provider.stat(file.path)) !== file.identity
  ) {
    throw new Error('SSH preview file changed; reopen the preview')
  }
}
export async function readSshPreviewRange(
  file: SshPreviewFile,
  offset: number,
  length: number,
  signal?: AbortSignal
): Promise<Uint8Array> {
  signal?.throwIfAborted()
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > MAX_FILE_RANGE_READ_BYTES
  ) {
    throw new Error('Invalid SSH preview range')
  }
  await assertSshPreviewFileCurrent(file)
  if (length === 0 || offset >= file.size) {
    return new Uint8Array(0)
  }
  const read = file.provider.readFileRange
  if (!read) {
    throw new Error('File previews require a newer SSH relay')
  }
  const range = await read.call(
    file.provider,
    file.path,
    offset,
    Math.min(length, Math.max(0, file.size - offset)),
    { signal }
  )
  signal?.throwIfAborted()
  await assertSshPreviewFileCurrent(file)
  return range.bytes.subarray(0, range.bytesRead)
}
