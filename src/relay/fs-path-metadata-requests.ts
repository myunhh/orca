import { readdir, stat, lstat, realpath } from 'node:fs/promises'
import { sortDirEntries } from '../shared/file-listing/file-name-sort'
import { expandTilde } from './context'
import { classifyFilesystemDirectoryEntries } from '../main/ipc/filesystem/filesystem-symlink-directory-entries'

function fileStatFromLstat(stats: Awaited<ReturnType<typeof lstat>>) {
  let type: 'file' | 'directory' | 'symlink' = 'file'
  if (stats.isDirectory()) {
    type = 'directory'
  } else if (stats.isSymbolicLink()) {
    type = 'symlink'
  }
  return {
    size: stats.size,
    type,
    mtime: stats.mtimeMs,
    mtimeMs: stats.mtimeMs,
    dev: stats.dev,
    ino: stats.ino,
    nlink: stats.nlink
  }
}

export async function readRelayDir(params: Record<string, unknown>) {
  const dirPath = expandTilde(params.dirPath as string)
  const entries = await readdir(dirPath, { withFileTypes: true })
  const mapped = await classifyFilesystemDirectoryEntries(
    dirPath,
    entries,
    params.followSymlinks === true,
    async (path) => path
  )
  return sortDirEntries(mapped)
}

export async function statRelayPath(params: Record<string, unknown>) {
  const filePath = expandTilde(params.filePath as string)
  const stats = await lstat(filePath)
  if (stats.isSymbolicLink()) {
    try {
      // Why: callers use stat to decide whether to read a path or enumerate
      // it; symlink-to-directory must behave like its target for that choice.
      const targetStats = await stat(filePath)
      return {
        size: targetStats.size,
        type: targetStats.isDirectory() ? 'directory' : 'file',
        mtime: targetStats.mtimeMs,
        mtimeMs: targetStats.mtimeMs,
        dev: targetStats.dev,
        ino: targetStats.ino,
        nlink: targetStats.nlink
      }
    } catch {
      return { size: stats.size, type: 'symlink', mtime: stats.mtimeMs }
    }
  }
  return fileStatFromLstat(stats)
}

export async function lstatRelayPath(params: Record<string, unknown>) {
  const filePath = expandTilde(params.filePath as string)
  return fileStatFromLstat(await lstat(filePath))
}

export async function realpathRelayPath(params: Record<string, unknown>) {
  const filePath = expandTilde(params.filePath as string)
  return await realpath(filePath)
}
