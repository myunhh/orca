import { useEffect, useState } from 'react'
import { AppWindow, Loader2, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import ImageViewer from '@/components/editor/ImageViewer'
import MarkdownPreview from '@/components/editor/markdown-preview/surface/MarkdownPreview'
import { translate } from '@/i18n/i18n'
import { createNonSecureContextUuid as createBrowserUuid } from '../../../../shared/non-secure-context-uuid'
import type {
  WorkbenchEditorContent,
  WorkbenchTabView
} from '../../../../shared/workbench-window/workbench-window-types'
import { sendWorkbenchCommand } from './workbench-window-commands'

type EditorBodyState =
  | { status: 'loading' }
  | { status: 'ready'; content: Extract<WorkbenchEditorContent, { status: 'ok' }> }
  | { status: 'error'; message: string }

/** Request the bytes from the main window, which owns SSH, runtime-host and grant routing. */
function useWorkbenchEditorContent(tabId: string, reloadToken: number): EditorBodyState {
  const requestKey = `${tabId}:${reloadToken}`
  const [answer, setAnswer] = useState<{ key: string; state: EditorBodyState } | null>(null)
  useEffect(() => {
    const api = window.api.workbenchWindows
    if (!api) {
      return
    }
    const requestId = createBrowserUuid()
    const off = api.onEditorContent((content) => {
      if (content.requestId !== requestId) {
        return
      }
      setAnswer({
        key: requestKey,
        state:
          content.status === 'ok'
            ? { status: 'ready', content }
            : { status: 'error', message: content.message }
      })
    })
    sendWorkbenchCommand({ kind: 'readEditorFile', tabId, requestId })
    return off
  }, [requestKey, tabId])
  return answer?.key === requestKey ? answer.state : { status: 'loading' }
}

export function WorkbenchEditorBody({ tab }: { tab: WorkbenchTabView }): React.JSX.Element | null {
  const [reloadToken, setReloadToken] = useState(0)
  const state = useWorkbenchEditorContent(tab.tabId, reloadToken)
  const editor = tab.editor
  if (!editor) {
    return null
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-2">
        <span className="min-w-0 flex-1 truncate font-mono text-2xs text-muted-foreground">
          {editor.relativePath || editor.filePath}
        </span>
        <Button variant="ghost" size="xs" onClick={() => setReloadToken((token) => token + 1)}>
          <RotateCw />
          {translate('components.workbench.window.WorkbenchEditorBody.reload', 'Reload')}
        </Button>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => sendWorkbenchCommand({ kind: 'revealInMain', tabId: tab.tabId })}
        >
          <AppWindow />
          {translate(
            'components.workbench.window.WorkbenchEditorBody.openInMain',
            'Open in Main Window'
          )}
        </Button>
      </div>
      {state.status === 'loading' ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {translate('components.workbench.window.WorkbenchEditorBody.loading', 'Loading file…')}
        </div>
      ) : state.status === 'error' ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground">
          {state.message}
        </div>
      ) : editor.isImage || state.content.isBinary ? (
        <div className="flex min-h-0 flex-1">
          <ImageViewer
            content={state.content.isBinary ? state.content.content : undefined}
            svgSource={state.content.isBinary ? undefined : state.content.content}
            filePath={editor.filePath}
            mimeType={state.content.mimeType ?? undefined}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col bg-editor-surface">
          <MarkdownPreview
            content={state.content.content}
            filePath={editor.filePath}
            sourceWorktreeId={tab.worktreeId}
            sourceRuntimeEnvironmentId={editor.runtimeEnvironmentId}
            scrollCacheKey={`workbench:${tab.tabId}`}
          />
        </div>
      )}
    </div>
  )
}
