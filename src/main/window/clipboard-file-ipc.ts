import { clipboard, ipcMain } from 'electron'
import { stat } from 'node:fs/promises'
import { runProcess } from '@orca/process-host'
import type { Store } from '../persistence/loading-store/store'
import { PATH_ACCESS_DENIED_MESSAGE } from '../ipc/filesystem/access/filesystem-auth'
import { resolveDesktopAuthorizedPath } from '../ipc/filesystem/access/local-file-access-resolution'
import { isENOENT } from '../ipc/filesystem/access/filesystem-path-containment'
import { abortWhenRendererGone } from '../ipc/renderer-lifetime-abort'
import { assertTrustedClipboardSender } from './clipboard-ipc-sender-trust'
import {
  writeFileToClipboard,
  type ClipboardFileDeps,
  type ClipboardFileResult
} from './clipboard-file-copy'
import { copySshFileToClipboard } from './clipboard-remote-file-copy'
import { ClipboardPublisherBusyError, publishClipboardOperation } from './clipboard-text-publisher'

type ClipboardWriteFileRequest = { filePath: string; connectionId?: string }

export function registerClipboardFileHandler(store: Store): void {
  ipcMain.handle(
    'clipboard:writeFile',
    async (event, args: unknown): Promise<ClipboardFileResult> => {
      assertTrustedClipboardSender(event)
      const request = normalizeClipboardWriteFileRequest(args)
      if (!request) {
        return { ok: false, reason: 'invalid-path' }
      }
      const deps = {
        platform: process.platform,
        desktop: process.env.XDG_CURRENT_DESKTOP,
        writeBuffer: (format: string, buffer: Buffer) => clipboard.writeBuffer(format, buffer),
        runProcess
      }
      try {
        if (request.connectionId != null) {
          const lifetime = abortWhenRendererGone(event.sender)
          try {
            return await copySshFileToClipboard(
              request.connectionId,
              request.filePath,
              deps,
              lifetime.signal
            )
          } finally {
            lifetime.dispose()
          }
        }
        const resolveFilePath: ClipboardFileDeps['resolveFilePath'] = async (path) => {
          try {
            const authorizedPath = await resolveDesktopAuthorizedPath(path, store)
            await stat(authorizedPath)
            return { ok: true, path: authorizedPath }
          } catch (error) {
            if (error instanceof Error && error.message === PATH_ACCESS_DENIED_MESSAGE) {
              return { ok: false, reason: 'access-denied' }
            }
            return { ok: false, reason: isENOENT(error) ? 'not-found' : 'invalid-path' }
          }
        }
        return await publishClipboardOperation(request.filePath.length * 2, () =>
          writeFileToClipboard(request.filePath, { ...deps, resolveFilePath })
        )
      } catch (error) {
        if (error instanceof ClipboardPublisherBusyError) {
          return { ok: false, reason: 'clipboard-busy' }
        }
        throw error
      }
    }
  )
}

function normalizeClipboardWriteFileRequest(args: unknown): ClipboardWriteFileRequest | null {
  if (typeof args === 'string') {
    return { filePath: args }
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return null
  }
  const { filePath, connectionId } = args as { filePath?: unknown; connectionId?: unknown }
  if (
    typeof filePath !== 'string' ||
    (connectionId != null && (typeof connectionId !== 'string' || connectionId.trim() === ''))
  ) {
    return null
  }
  return { filePath, ...(typeof connectionId === 'string' ? { connectionId } : {}) }
}
