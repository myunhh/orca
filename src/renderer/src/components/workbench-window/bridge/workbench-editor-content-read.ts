import type { AppState } from '@/store/types'
import type { WorkbenchEditorContent } from '../../../../../shared/workbench-window/workbench-window-types'
import { WORKBENCH_MAX_EDITOR_CONTENT_CHARS } from '../../../../../shared/workbench-window/workbench-window-types'
import { readRuntimeFileContent } from '@/runtime/files/reads/runtime-file-read-client'
import { requireRuntimeTargetForFileOwner } from '@/lib/files/access/file-owner-runtime-target'
import { getConnectionIdForFile } from '@/lib/workspace/ownership/connection-context'
import { editorTabFileAccess, isClientLocalReadOnlyTab } from '@/lib/files/access/local-file-access'
import { translate } from '@/i18n/i18n'
import { findUnifiedTab, isWorkbenchViewableFile } from '../workbench-tab-eligibility'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The main window owns file routing (SSH, runtime hosts, grants); a workbench window only renders the bytes. */
export async function readWorkbenchEditorContent(
  state: AppState,
  tabId: string,
  requestId: string
): Promise<WorkbenchEditorContent> {
  const tab = findUnifiedTab(state, tabId)
  const file = tab ? state.openFiles.find((candidate) => candidate.id === tab.entityId) : undefined
  if (!file || !isWorkbenchViewableFile(file)) {
    return {
      requestId,
      tabId,
      status: 'error',
      message: translate(
        'components.workbench.window.bridge.workbench.editor.content.read.unavailable',
        'This file is no longer open.'
      )
    }
  }
  try {
    const clientLocal = isClientLocalReadOnlyTab(file)
    const target =
      clientLocal && file.runtimeEnvironmentId === undefined
        ? { kind: 'local' as const }
        : requireRuntimeTargetForFileOwner(state, file.worktreeId, file.runtimeEnvironmentId)
    const connectionId = clientLocal
      ? undefined
      : (getConnectionIdForFile(file.worktreeId, file.filePath) ?? undefined)
    // Base64 rather than an orca-media URL: preview grants are minted per renderer.
    const result = await readRuntimeFileContent({
      target,
      filePath: file.filePath,
      relativePath: file.relativePath,
      worktreeId: file.worktreeId,
      connectionId,
      expectedExternalSshTargetId: file.externalSshTargetId,
      access: editorTabFileAccess(state, file),
      terminalArtifactGrantId: file.terminalArtifactGrantId
    })
    if (result.content.length > WORKBENCH_MAX_EDITOR_CONTENT_CHARS) {
      return {
        requestId,
        tabId,
        status: 'error',
        message: translate(
          'components.workbench.window.bridge.workbench.editor.content.read.tooLarge',
          'This file is too large to show here. Open it in the main window.'
        )
      }
    }
    return {
      requestId,
      tabId,
      status: 'ok',
      content: result.content,
      isBinary: result.isBinary,
      mimeType: result.mimeType ?? null
    }
  } catch (error) {
    return { requestId, tabId, status: 'error', message: errorMessage(error) }
  }
}
