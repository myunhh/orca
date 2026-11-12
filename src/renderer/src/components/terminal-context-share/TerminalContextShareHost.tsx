import { Suspense } from 'react'
import { lazyWithRetry as lazy } from '@/app-shell/startup/lazy-with-retry'
import {
  closeTerminalContextShareDialog,
  useTerminalContextShareRequest
} from './terminal-context-share-request'

const ShareTerminalContextDialog = lazy(() => import('./ShareTerminalContextDialog'))
const LinkTerminalsDialog = lazy(() => import('./LinkTerminalsDialog'))

/** Mount once per window; dialogs load only when a share or link is requested. */
export function TerminalContextShareHost(): React.JSX.Element | null {
  const request = useTerminalContextShareRequest((state) => state.request)
  if (!request) {
    return null
  }
  const Dialog = request.kind === 'link' ? LinkTerminalsDialog : ShareTerminalContextDialog
  return (
    <Suspense fallback={null}>
      <Dialog
        key={request.id}
        source={request.source}
        preferredTarget={request.preferredTarget}
        onClose={closeTerminalContextShareDialog}
      />
    </Suspense>
  )
}
