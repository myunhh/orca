import { ipcMain } from 'electron'
import { listQuickOpenFiles } from './filesystem-list-files'
import {
  isFileNameFilterQueryTooLarge,
  pathMatchesFileNameFilterTokens,
  splitFileNameFilterTokens
} from '../../../shared/file-listing/file-name-filter-tokens'
import type { FilesystemHandlerContext } from './filesystem-handler-context'
import { registerFilesystemContentSearchHandler } from './filesystem-content-search-handler'
import { requireSshFilesystemProvider } from '../../providers/ssh-filesystem-dispatch'

export function registerFilesystemSearchHandlers(context: FilesystemHandlerContext): void {
  registerFilesystemContentSearchHandler(context)
  const { store } = context
  const { listFilesCancellations } = context
  ipcMain.handle(
    'fs:listFiles',
    async (
      event,
      args: {
        rootPath: string
        connectionId?: string
        excludePaths?: string[]
        requestToken?: string
        maxResults?: number
        candidatePaths?: string[]
        searchQuery?: string
        includeIgnored?: boolean
        allowLegacyIncludeIgnored?: boolean
        followSymlinks?: boolean
        /** Local only: keep paths containing every whitespace-separated word, like the Explorer filter. */
        nameFilter?: string
      }
    ): Promise<string[]> => {
      const controller = listFilesCancellations.begin(event, args.requestToken)
      try {
        if (args.nameFilter !== undefined && isFileNameFilterQueryTooLarge(args.nameFilter)) {
          return []
        }
        const nameFilterTokens = args.nameFilter ? splitFileNameFilterTokens(args.nameFilter) : []
        if (args.connectionId != null) {
          const files = await requireSshFilesystemProvider(args.connectionId).listFiles(
            args.rootPath,
            {
              ...args,
              signal: controller?.signal,
              maxResults: nameFilterTokens.length ? undefined : args.maxResults
            }
          )
          const filtered = nameFilterTokens.length
            ? files.filter((path) => pathMatchesFileNameFilterTokens(path, nameFilterTokens))
            : files
          return args.maxResults === undefined ? filtered : filtered.slice(0, args.maxResults)
        }
        return await listQuickOpenFiles(
          args.rootPath,
          store,
          args.excludePaths,
          controller?.signal,
          args.maxResults,
          undefined,
          nameFilterTokens.length > 0
            ? (relativePath) => pathMatchesFileNameFilterTokens(relativePath, nameFilterTokens)
            : undefined,
          args
        )
      } finally {
        listFilesCancellations.finish(event, args.requestToken, controller)
      }
    }
  )

  ipcMain.handle('fs:cancelListFiles', (event, args: { requestToken: string }): void => {
    listFilesCancellations.cancel(event, args.requestToken)
  })
}
