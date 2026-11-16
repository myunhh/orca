import {
  getSshFilesystemProvider,
  requireSshFilesystemProvider
} from '../providers/ssh-filesystem-dispatch'
import type { IFilesystemProvider } from '../providers/filesystem-provider-contract'
import { MAX_FILE_RANGE_READ_BYTES } from '../../shared/file-content/file-range-read'
import type { SshTranscriptLocation } from './ssh-transcript-path'

export type SshTranscriptHandle = {
  sshTranscript: SshTranscriptLocation
  provider: IFilesystemProvider
}

export function openSshTranscript(location: SshTranscriptLocation): SshTranscriptHandle {
  return { sshTranscript: location, provider: requireSshFilesystemProvider(location.connectionId) }
}
export async function statSshTranscript(location: SshTranscriptLocation): Promise<{
  size: number
  mtimeMs: number
  ctimeMs: number
  dev: number
  ino: number
}> {
  const info = await requireSshFilesystemProvider(location.connectionId).stat(location.remotePath)
  if (info.type !== 'file') {
    throw new Error('not_a_file')
  }
  return {
    size: info.size,
    mtimeMs: info.mtimeMs ?? info.mtime,
    ctimeMs: info.ctimeMs ?? 0,
    dev: info.dev ?? 0,
    ino: info.ino ?? 0
  }
}

export async function readSshTranscript(
  handle: SshTranscriptHandle,
  buffer: Buffer,
  offset: number,
  length: number,
  position: number,
  signal?: AbortSignal
): Promise<{ bytesRead: number; buffer: Buffer }> {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > buffer.length ||
    !Number.isSafeInteger(position) ||
    position < 0
  ) {
    throw new Error('Invalid transcript read range')
  }
  const { provider, sshTranscript } = handle
  if (!provider.readFileRange) {
    throw new Error('Transcript range reads require a newer SSH relay')
  }
  let bytesRead = 0
  while (bytesRead < length) {
    signal?.throwIfAborted()
    if (getSshFilesystemProvider(sshTranscript.connectionId) !== provider) {
      throw new Error('SSH transcript connection changed')
    }
    const requestedLength = Math.min(length - bytesRead, MAX_FILE_RANGE_READ_BYTES)
    const range = await provider.readFileRange(
      sshTranscript.remotePath,
      position + bytesRead,
      requestedLength,
      { signal }
    )
    buffer.set(range.bytes.subarray(0, range.bytesRead), offset + bytesRead)
    bytesRead += range.bytesRead
    if (range.bytesRead < requestedLength) {
      break
    }
  }
  return { bytesRead, buffer }
}
