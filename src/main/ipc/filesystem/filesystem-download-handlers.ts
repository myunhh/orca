import { BrowserWindow, dialog, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { open, writeFile } from 'node:fs/promises'
import { requireSshFilesystemProvider } from '../../providers/ssh-filesystem-dispatch'
import { sanitizeLocalDownloadFilename } from './local-download-filename'
import { abortWhenRendererGone } from '../renderer-lifetime-abort'
import type { FilesystemHandlerContext } from './filesystem-handler-context'
import {
  cleanupLocalTransferPath,
  decodeDownloadedFileContent,
  DOWNLOAD_SESSION_TTL_MS,
  inspectDownloadDestination,
  promoteDownloadedFile,
  createSiblingTransferPath,
  type DownloadFileResult
} from './filesystem-download-promotion'
import { getRuntimePathBasename } from '../../../shared/cross-platform-path'
import { join } from 'node:path'
import { rm, stat } from 'node:fs/promises'
import { isENOENT } from './access/filesystem-path-containment'
import { promoteLocalDownloadedFolder } from './local-downloaded-folder-promotion'

function validateRequiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} is required`)
  }
  return value
}

export function registerFilesystemDownloadHandlers(context: FilesystemHandlerContext): void {
  const { downloadSessions, closeDownloadSession } = context

  ipcMain.handle(
    'fs:downloadFile',
    async (
      event,
      args: { filePath?: string; connectionId?: string }
    ): Promise<DownloadFileResult> => {
      const filePath = validateRequiredString(args?.filePath, 'filePath')
      const connectionId = validateRequiredString(args?.connectionId, 'connectionId')
      const provider = requireSshFilesystemProvider(connectionId)
      if (!provider.downloadFile) {
        throw new Error('Remote file download is unavailable on this SSH connection')
      }
      const lifetime = abortWhenRendererGone(event.sender)
      let tempPath: string | null = null
      try {
        const info = await provider.stat(filePath)
        if (info.type === 'directory') {
          throw new Error('Cannot download a directory')
        }
        lifetime.signal.throwIfAborted()
        const options = {
          defaultPath: sanitizeLocalDownloadFilename(getRuntimePathBasename(filePath))
        }
        const window = BrowserWindow.fromWebContents(event.sender)
        const picked = window
          ? await dialog.showSaveDialog(window, options)
          : await dialog.showSaveDialog(options)
        if (picked.canceled || !picked.filePath) {
          return { canceled: true }
        }
        lifetime.signal.throwIfAborted()
        const destinationPath = picked.filePath
        const { existed } = await inspectDownloadDestination(destinationPath)
        tempPath = createSiblingTransferPath(destinationPath, 'download')
        await provider.downloadFile(filePath, tempPath)
        lifetime.signal.throwIfAborted()
        await promoteDownloadedFile(tempPath, destinationPath, existed)
        tempPath = null
        return { canceled: false, destinationPath }
      } finally {
        lifetime.dispose()
        await cleanupLocalTransferPath(tempPath)
      }
    }
  )

  ipcMain.handle(
    'fs:downloadFolder',
    async (
      event,
      args: { dirPath?: string; connectionId?: string }
    ): Promise<DownloadFileResult> => {
      const dirPath = validateRequiredString(args?.dirPath, 'dirPath')
      const connectionId = validateRequiredString(args?.connectionId, 'connectionId')
      const provider = requireSshFilesystemProvider(connectionId)
      if (!provider.downloadFolder) {
        throw new Error('Remote folder download is unavailable on this SSH connection')
      }
      const lifetime = abortWhenRendererGone(event.sender)
      let tempPath: string | null = null
      try {
        lifetime.signal.throwIfAborted()
        const options: Electron.OpenDialogOptions = {
          properties: ['openDirectory', 'createDirectory']
        }
        const window = BrowserWindow.fromWebContents(event.sender)
        const picked = window
          ? await dialog.showOpenDialog(window, options)
          : await dialog.showOpenDialog(options)
        if (picked.canceled || !picked.filePaths[0]) {
          return { canceled: true }
        }
        lifetime.signal.throwIfAborted()
        const destinationPath = join(
          picked.filePaths[0],
          sanitizeLocalDownloadFilename(getRuntimePathBasename(dirPath))
        )
        try {
          await stat(destinationPath)
          throw new Error('Destination folder already exists')
        } catch (error) {
          if (!isENOENT(error)) {
            throw error
          }
        }
        tempPath = createSiblingTransferPath(destinationPath, 'download')
        await provider.downloadFolder(dirPath, tempPath, { signal: lifetime.signal })
        lifetime.signal.throwIfAborted()
        await promoteLocalDownloadedFolder(tempPath, destinationPath, lifetime.signal)
        tempPath = null
        return { canceled: false, destinationPath }
      } finally {
        lifetime.dispose()
        if (tempPath) {
          await rm(tempPath, { recursive: true, force: true })
        }
      }
    }
  )

  ipcMain.handle(
    'fs:saveDownloadedFile',
    async (
      event,
      args: { suggestedName?: string; content?: string; encoding?: 'utf8' | 'base64' }
    ): Promise<DownloadFileResult> => {
      const suggestedName = sanitizeLocalDownloadFilename(
        validateRequiredString(args?.suggestedName, 'suggestedName')
      )
      if (typeof args?.content !== 'string') {
        throw new Error('content is required')
      }
      const content = args.content
      const encoding = args?.encoding === 'base64' ? 'base64' : 'utf8'
      const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined
      const dialogResult = parentWindow
        ? await dialog.showSaveDialog(parentWindow, { defaultPath: suggestedName })
        : await dialog.showSaveDialog({ defaultPath: suggestedName })
      if (dialogResult.canceled || !dialogResult.filePath) {
        return { canceled: true }
      }

      const destinationPath = dialogResult.filePath
      const { existed } = await inspectDownloadDestination(destinationPath)
      const tempPath = createSiblingTransferPath(destinationPath, 'download')
      let promoted = false
      try {
        await writeFile(tempPath, decodeDownloadedFileContent(content, encoding))
        await promoteDownloadedFile(tempPath, destinationPath, existed)
        promoted = true
        return { canceled: false, destinationPath }
      } finally {
        if (!promoted) {
          await cleanupLocalTransferPath(tempPath)
        }
      }
    }
  )

  ipcMain.handle(
    'fs:startDownloadedFile',
    async (
      event,
      args: { suggestedName?: string }
    ): Promise<
      { canceled: true } | { canceled: false; transferId: string; destinationPath: string }
    > => {
      const suggestedName = sanitizeLocalDownloadFilename(
        validateRequiredString(args?.suggestedName, 'suggestedName')
      )
      if (event.sender.isDestroyed()) {
        return { canceled: true }
      }
      const lifetime = abortWhenRendererGone(event.sender)
      const transferId = randomUUID()
      const disposeRendererLifetime = (): void => {
        lifetime.signal.removeEventListener('abort', onRendererGone)
        lifetime.dispose()
      }
      const onRendererGone = (): void => {
        disposeRendererLifetime()
        void closeDownloadSession(transferId, true)
      }
      lifetime.signal.addEventListener('abort', onRendererGone, { once: true })
      let admitted = false
      let tempPath: string | null = null
      let handle: Awaited<ReturnType<typeof open>> | null = null
      try {
        const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined
        const dialogResult = parentWindow
          ? await dialog.showSaveDialog(parentWindow, { defaultPath: suggestedName })
          : await dialog.showSaveDialog({ defaultPath: suggestedName })
        if (lifetime.signal.aborted || dialogResult.canceled || !dialogResult.filePath) {
          return { canceled: true }
        }

        const destinationPath = dialogResult.filePath
        const { existed } = await inspectDownloadDestination(destinationPath)
        if (lifetime.signal.aborted) {
          return { canceled: true }
        }
        tempPath = createSiblingTransferPath(destinationPath, 'download')
        handle = await open(tempPath, 'wx')
        if (lifetime.signal.aborted) {
          return { canceled: true }
        }
        const cleanupTimer = setTimeout(() => {
          void closeDownloadSession(transferId, true)
        }, DOWNLOAD_SESSION_TTL_MS)
        if (typeof cleanupTimer.unref === 'function') {
          cleanupTimer.unref()
        }
        downloadSessions.set(transferId, {
          destinationPath,
          tempPath,
          destinationExisted: existed,
          handle,
          cleanupTimer,
          disposeRendererLifetime
        })
        admitted = true
        return { canceled: false, transferId, destinationPath }
      } finally {
        if (!admitted) {
          disposeRendererLifetime()
          await handle?.close().catch(() => {})
          await cleanupLocalTransferPath(tempPath)
        }
      }
    }
  )

  ipcMain.handle(
    'fs:appendDownloadedFileChunk',
    async (
      _event,
      args: { transferId?: string; contentBase64?: string }
    ): Promise<{ ok: true }> => {
      const transferId = validateRequiredString(args?.transferId, 'transferId')
      const contentBase64 = validateRequiredString(args?.contentBase64, 'contentBase64')
      const session = downloadSessions.get(transferId)
      if (!session) {
        throw new Error('Download session not found')
      }
      await session.handle.writeFile(Buffer.from(contentBase64, 'base64'))
      return { ok: true }
    }
  )

  ipcMain.handle(
    'fs:finishDownloadedFile',
    async (
      _event,
      args: { transferId?: string }
    ): Promise<{ canceled: false; destinationPath: string }> => {
      const transferId = validateRequiredString(args?.transferId, 'transferId')
      const session = await closeDownloadSession(transferId, false)
      if (!session) {
        throw new Error('Download session not found')
      }
      let promoted = false
      try {
        await promoteDownloadedFile(
          session.tempPath,
          session.destinationPath,
          session.destinationExisted
        )
        promoted = true
        return { canceled: false, destinationPath: session.destinationPath }
      } finally {
        if (!promoted) {
          await cleanupLocalTransferPath(session.tempPath)
        }
      }
    }
  )

  ipcMain.handle(
    'fs:cancelDownloadedFile',
    async (_event, args: { transferId?: string }): Promise<{ ok: true }> => {
      const transferId = validateRequiredString(args?.transferId, 'transferId')
      await closeDownloadSession(transferId, true)
      return { ok: true }
    }
  )
}
