import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { lstat } from 'node:fs/promises'
import { getRuntimePathBasename } from '../../shared/cross-platform-path'
import { sanitizeLocalDownloadFilename } from '../ipc/filesystem/local-download-filename'
import {
  getSshFilesystemProvider,
  requireSshFilesystemProvider
} from '../providers/ssh-filesystem-dispatch'
import {
  writeFileToClipboard,
  type ClipboardFileDeps,
  type ClipboardFileResult
} from './clipboard-file-copy'
import { publishClipboardOperation } from './clipboard-text-publisher'

import {
  cleanupExpiredRemoteClipboardStaging,
  cleanupLegacyRemoteClipboardStaging,
  createRemoteClipboardTransferDirectory,
  removeRemoteClipboardTransferDirectory,
  scheduleRemoteClipboardTransferCleanup
} from './clipboard-remote-file-staging'

const REMOTE_CLIPBOARD_LEGACY_CLEANUP_DELAY_MS = 30 * 1000
let legacyCleanupScheduled = false

/** Download outside the publisher queue; only an owned, completed transfer is published. */
export async function copySshFileToClipboard(
  connectionId: string,
  filePath: string,
  deps: Omit<ClipboardFileDeps, 'resolveFilePath'>,
  signal: AbortSignal
): Promise<ClipboardFileResult> {
  const provider = requireSshFilesystemProvider(connectionId)
  if (!provider.downloadFile) {
    throw new Error('File clipboard copies require a newer SSH relay')
  }
  const info = await provider.stat(filePath)
  if (info.type !== 'file') {
    return { ok: false, reason: 'invalid-path' }
  }
  signal.throwIfAborted()
  const tempRoot = app.getPath('temp')
  const directory = await createRemoteClipboardTransferDirectory(tempRoot, Date.now(), randomUUID())
  const destination = join(
    directory,
    sanitizeLocalDownloadFilename(getRuntimePathBasename(filePath))
  )
  let published = false
  try {
    await provider.downloadFile(filePath, destination)
    signal.throwIfAborted()
    if (
      getSshFilesystemProvider(connectionId) !== provider ||
      !(await lstat(destination)).isFile()
    ) {
      throw new Error('SSH clipboard transfer changed')
    }
    const result = await publishClipboardOperation(destination.length * 2, () =>
      writeFileToClipboard(destination, {
        ...deps,
        resolveFilePath: async (requestedPath) => {
          signal.throwIfAborted()
          return requestedPath === destination && (await lstat(destination)).isFile()
            ? { ok: true, path: destination }
            : { ok: false, reason: 'invalid-path' }
        }
      })
    )
    published = result.ok
    return result
  } finally {
    if (published) {
      scheduleRemoteClipboardTransferCleanup(tempRoot, directory)
    } else {
      await removeRemoteClipboardTransferDirectory(tempRoot, directory)
    }
  }
}

export async function cleanupExpiredRemoteClipboardFiles(nowMs = Date.now()): Promise<void> {
  await cleanupExpiredRemoteClipboardStaging(app.getPath('temp'), nowMs)
}

export async function cleanupLegacyRemoteClipboardFiles(nowMs = Date.now()): Promise<void> {
  await cleanupLegacyRemoteClipboardStaging(app.getPath('temp'), nowMs)
}

export function scheduleLegacyRemoteClipboardFileCleanup(): void {
  if (legacyCleanupScheduled) {
    return
  }
  legacyCleanupScheduled = true
  const timer = setTimeout(() => {
    void cleanupLegacyRemoteClipboardFiles().catch(() => undefined)
  }, REMOTE_CLIPBOARD_LEGACY_CLEANUP_DELAY_MS)
  unrefTimer(timer)
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer === 'object' && 'unref' in timer) {
    timer.unref()
  }
}
