import { ipcMain } from 'electron'
import type { ResolveDroppedPathsResult } from '../../../shared/file-import/filesystem-import-result'
import type { SshMutationExpectation } from '../../../shared/ssh-types'
import { assertSshMutationExpectation } from '../../ssh/connection/authority/ssh-connection-generation'
import { joinWorktreeRelativePath } from '../../runtime/files/paths/runtime-relative-paths'
import { resolveLocalDroppedPathsForAgent } from '../dropped-path-resolution'
import { abortWhenRendererGone } from '../renderer-lifetime-abort'
import { importExternalPathsSsh } from './filesystem-import-ssh'

export function registerFilesystemDroppedPathHandlers(): void {
  ipcMain.handle(
    'fs:resolveDroppedPathsForAgent',
    async (
      event,
      args: {
        paths: string[]
        worktreePath: string
        connectionId?: string
      } & SshMutationExpectation
    ): Promise<ResolveDroppedPathsResult> => {
      const assertCurrent = (): void =>
        assertSshMutationExpectation(
          args.connectionId,
          args.expectedSshTargetId,
          args.expectedSshConnectionGeneration,
          args.expectedExecutionHostId
        )
      assertCurrent()
      if (args.connectionId == null) {
        return {
          resolvedPaths: resolveLocalDroppedPathsForAgent(args.paths, args.worktreePath),
          skipped: [],
          failed: []
        }
      }
      const lifetime = abortWhenRendererGone(event.sender)
      try {
        const { results } = await importExternalPathsSsh(
          args.paths,
          joinWorktreeRelativePath(args.worktreePath, '.orca/drops'),
          args.connectionId,
          { ensureDir: true, assertCurrent, signal: lifetime.signal }
        )
        return {
          resolvedPaths: results.flatMap((result) =>
            result.status === 'imported' ? [result.destPath] : []
          ),
          skipped: results.flatMap((result) =>
            result.status === 'skipped'
              ? [{ sourcePath: result.sourcePath, reason: result.reason }]
              : []
          ),
          failed: results.flatMap((result) =>
            result.status === 'failed'
              ? [{ sourcePath: result.sourcePath, reason: result.reason }]
              : []
          )
        }
      } finally {
        lifetime.dispose()
      }
    }
  )
}
