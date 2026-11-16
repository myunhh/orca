import { ipcMain } from 'electron'
import { fileRangePage, readLocalFileRange } from './local-file-range-read'
import { validateFileRangeRequest } from '../../../shared/file-content/file-range-read'
import { requireSshFilesystemProvider } from '../../providers/ssh-filesystem-dispatch'
import { resolveLocalFileRequestPath } from './access/local-file-access-resolution'
import type { LocalFileAccess } from '../../../shared/file-access/local-file-access'
import type { FilesystemHandlerContext } from './filesystem-handler-context'
import { guardWslUncPathAccess } from '../../wsl/filesystem/wsl-unc-access-gate'

export function registerFilesystemChunkReadHandler({ store }: FilesystemHandlerContext): void {
  ipcMain.handle(
    'fs:readFileChunk',
    async (
      _event,
      args: {
        filePath: string
        connectionId?: string
        access?: LocalFileAccess
        offset: number
        length: number
        wakeWslDistro?: boolean
      }
    ) => {
      validateFileRangeRequest(args.offset, args.length)
      if (args.connectionId != null) {
        const provider = requireSshFilesystemProvider(args.connectionId)
        if (!provider.readFileRange) {
          throw new Error('File range reads require a newer SSH relay')
        }
        const info = await provider.stat(args.filePath)
        if (info.type !== 'file') {
          throw new Error('not_a_file')
        }
        const range = await provider.readFileRange(args.filePath, args.offset, args.length)
        return fileRangePage(range.bytes.subarray(0, range.bytesRead), args.offset, info.size)
      }
      return guardWslUncPathAccess(
        args.filePath,
        async () =>
          readLocalFileRange(
            await resolveLocalFileRequestPath(args.filePath, args.access, store),
            args.offset,
            args.length
          ),
        { wake: args.wakeWslDistro === true }
      )
    }
  )
}
