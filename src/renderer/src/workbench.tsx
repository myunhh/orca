// Install the import-free hook before react-dom reads it during evaluation; the observer below wraps a per-commit property and can load later.
import './lib/react-devtools-commit-hook-shim'
import './lib/react-commit-cascade-observer'
import './assets/main.css'

import { StrictMode } from 'react'
import { useTranslation } from 'react-i18next'
import { Toaster } from './components/ui/sonner'
import { WorkbenchWindowRoot } from './components/workbench-window/WorkbenchWindowRoot'
import { registerWorkbenchPaneHeaderActions } from './components/workbench-window/workbench-pane-header-actions'
import { renderWorkbenchTerminalShareActions } from './components/workbench-window/WorkbenchTerminalShareActions'
import { TerminalContextShareHost } from './components/terminal-context-share/TerminalContextShareHost'
import { RecoverableRenderErrorBoundary } from './components/error-boundaries/RecoverableRenderErrorBoundary'
import {
  installRendererCrashDiagnostics,
  recordRendererCrashBreadcrumb
} from './lib/crash-diagnostics'
import { I18nProvider } from './i18n/I18nProvider'
import { CompanionWindowSettingsSync } from './components/companion-window/CompanionWindowSettingsSync'
import { seedCompanionWindowSettings } from './components/companion-window/companion-window-appearance'
import { translate } from './i18n/i18n'
import { getOrCreateRendererRoot } from './lib/react-renderer-root'
import { setReactCommitCascadeRendererSurface } from './lib/react-commit-cascade-telemetry'
import { installOsFileDropCancellationGuard } from './lib/os-file-drop-cancellation-guard'
import { installBodyOverlayAttributes } from './lib/body-overlay-attributes'

const disposeOsFileDropGuard = installOsFileDropCancellationGuard()
import.meta.hot?.dispose(disposeOsFileDropGuard)
const disposeBodyOverlayAttributes = installBodyOverlayAttributes()
import.meta.hot?.dispose(disposeBodyOverlayAttributes)
// A view over main-owned tabs: separate store seeded with settings only, no session or UI writers.
recordRendererCrashBreadcrumb('workbench_bootstrap_started', { dev: import.meta.env.DEV })
installRendererCrashDiagnostics('workbench-window')
setReactCommitCascadeRendererSurface('workbench-window')

seedCompanionWindowSettings()
const unregisterShareActions = registerWorkbenchPaneHeaderActions(
  renderWorkbenchTerminalShareActions
)
import.meta.hot?.dispose(unregisterShareActions)

const rootElement = document.getElementById('root')
if (!rootElement) {
  recordRendererCrashBreadcrumb('workbench_root_missing')
  throw new Error('Workbench root element not found.')
}

function WorkbenchRoot(): React.JSX.Element {
  useTranslation()
  return (
    <RecoverableRenderErrorBoundary
      boundaryId="workbench-window.root"
      surface="workbench-window"
      title={translate('workbenchWindow.recoverableError.title', 'This Orca window hit an error.')}
      description={translate(
        'workbenchWindow.recoverableError.description',
        'The window could not finish rendering. Retry to remount it, or close it to return its tabs.'
      )}
    >
      <WorkbenchWindowRoot />
    </RecoverableRenderErrorBoundary>
  )
}

getOrCreateRendererRoot(rootElement, import.meta.hot?.data).render(
  <StrictMode>
    <I18nProvider>
      <CompanionWindowSettingsSync />
      <WorkbenchRoot />
      <TerminalContextShareHost />
      <Toaster />
    </I18nProvider>
  </StrictMode>
)
recordRendererCrashBreadcrumb('workbench_bootstrap_rendered')
