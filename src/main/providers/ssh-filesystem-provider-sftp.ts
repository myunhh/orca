import type { FileEntryWithStats, SFTPWrapper, Stats } from 'ssh2'
import type { FileStat } from './filesystem-provider-contract'

const ABORTED_SFTP_OPERATION_GRACE_MS = 5_000

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('Download canceled')
}

function waitForSftpCallback<T>(
  register: (callback: (err?: Error | null, value?: T) => void) => void,
  options?: { signal?: AbortSignal }
): Promise<T> {
  return new Promise((resolve, reject) => {
    const signal = options?.signal
    if (signal?.aborted) {
      reject(abortReason(signal))
      return
    }

    let settled = false
    let abortTimer: ReturnType<typeof setTimeout> | undefined
    const cleanup = (): void => {
      clearTimeout(abortTimer)
      signal?.removeEventListener('abort', onAbort)
    }
    const settle = (error?: Error | null, value?: T): void => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      if (signal?.aborted) {
        reject(abortReason(signal))
      } else if (error) {
        reject(error)
      } else {
        resolve(value as T)
      }
    }
    const onAbort = (): void => {
      if (!signal || settled) {
        return
      }
      // Abort closes SFTP; await its callback so Windows handles quiesce before temporary-tree removal.
      abortTimer = setTimeout(() => settle(abortReason(signal)), ABORTED_SFTP_OPERATION_GRACE_MS)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      register((error, value) => settle(error, value))
    } catch (error) {
      settle(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

export function fastGetViaSftp(
  sftp: SFTPWrapper,
  sourcePath: string,
  destinationPath: string,
  options?: { signal?: AbortSignal }
): Promise<void> {
  return waitForSftpCallback<void>(
    (callback) => sftp.fastGet(sourcePath, destinationPath, callback),
    options
  )
}

export function fileStatFromSftpStats(stats: Stats): FileStat {
  const type = stats.isDirectory() ? 'directory' : stats.isSymbolicLink() ? 'symlink' : 'file'
  const nlink = 'nlink' in stats && typeof stats.nlink === 'number' ? stats.nlink : undefined
  return {
    size: stats.size,
    type,
    mtime: stats.mtime * 1000,
    ...(nlink === undefined ? {} : { nlink })
  }
}

export function lstatViaSftp(sftp: SFTPWrapper, filePath: string): Promise<FileStat> {
  const { promise, resolve, reject } = Promise.withResolvers<FileStat>()
  sftp.lstat(filePath, (error, stats) => {
    if (error) {
      reject(error)
    } else {
      resolve(fileStatFromSftpStats(stats))
    }
  })
  return promise
}

export function readDirViaSftp(
  sftp: SFTPWrapper,
  dirPath: string,
  options?: { signal?: AbortSignal }
): Promise<FileEntryWithStats[]> {
  return waitForSftpCallback<FileEntryWithStats[]>(
    (callback) => sftp.readdir(dirPath, callback),
    options
  )
}

export function statViaSftp(
  sftp: SFTPWrapper,
  filePath: string,
  options?: { signal?: AbortSignal }
): Promise<Stats> {
  return waitForSftpCallback<Stats>((callback) => sftp.stat(filePath, callback), options)
}
