// Install the import-free hook before react-dom reads it during evaluation; the observer below wraps a per-commit property and can load later.
import './diagnostics/react-commits/react-devtools-commit-hook-shim'
import './diagnostics/react-commits/react-commit-cascade-observer'
import './assets/main.css'

import { StrictMode } from 'react'
import { useTranslation } from 'react-i18next'
import { Toaster } from './components/ui/sonner'
import { WorkbenchWindowRoot } from './components/workbench-window/WorkbenchWindowRoot'
import { registerWorkbenchPaneHeaderActions } from './components/workbench-window/workbench-pane-header-actions'
import { renderWorkbenchTerminalShareActions } from './components/workbench-window/WorkbenchTerminalShareActions'
import { TerminalContextShareHost } from './components/terminal-context-share/TerminalContextShareHost'
import { RecoverableRenderErrorBoundary } from './components/error-boundaries/RecoverableRenderErrorBoundary'
import { installRendererCrashDiagnostics } from './diagnostics/crash-reporting/crash-diagnostics'
import { recordRendererCrashBreadcrumb } from './diagnostics/crash-reporting/crash-breadcrumb-recorder'
import { I18nProvider } from './i18n/I18nProvider'
import { CompanionWindowSettingsSync } from './components/companion-window/CompanionWindowSettingsSync'
import { seedCompanionWindowSettings } from './components/companion-window/companion-window-appearance'
import { translate } from './i18n/i18n'
import { getOrCreateRendererRoot } from './app-shell/startup/react-renderer-root'
import { setReactCommitCascadeRendererSurface } from './diagnostics/react-commits/react-commit-cascade-telemetry'
import { installOsFileDropCancellationGuard } from './lib/files/drop/os-file-drop-cancellation-guard'
import { installBodyOverlayAttributes } from './lib/overlay-interaction/body-overlay-attributes'

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
      <RecoverableRenderErrorBoundary
        boundaryId="workbench-window.terminal-context-share"
        surface="workbench-window"
        title={translate(
          'workbenchWindow.terminalContextShareError.title',
          'The context sharing dialog hit an error.'
        )}
        description={translate(
          'workbenchWindow.terminalContextShareError.description',
          'Retry to reopen it. Terminals in this window are unaffected.'
        )}
      >
        <TerminalContextShareHost />
      </RecoverableRenderErrorBoundary>
      <Toaster />
    </I18nProvider>
  </StrictMode>
)
recordRendererCrashBreadcrumb('workbench_bootstrap_rendered')
