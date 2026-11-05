// Install the import-free hook before react-dom reads it during evaluation; the observer below wraps a per-commit property and can load later.
import './lib/react-devtools-commit-hook-shim'
import './lib/react-commit-cascade-observer'
import './assets/main.css'

import { StrictMode } from 'react'
import { useTranslation } from 'react-i18next'
import { DashboardPopoutRoot } from './components/dashboard-popout/DashboardPopoutRoot'
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
// Each popout has a separate React root/DOM/JS context; run full renderer bootstrap despite sharing preload/window.api.
recordRendererCrashBreadcrumb('popout_bootstrap_started', { dev: import.meta.env.DEV })
installRendererCrashDiagnostics('dashboard-popout')
setReactCommitCascadeRendererSurface('dashboard-popout')

seedCompanionWindowSettings()

const rootElement = document.getElementById('root')
if (!rootElement) {
  recordRendererCrashBreadcrumb('popout_root_missing')
  throw new Error('Pop-out root element not found.')
}

function PopoutRoot(): React.JSX.Element {
  useTranslation()
  return (
    <RecoverableRenderErrorBoundary
      boundaryId="dashboard-popout.root"
      surface="dashboard-popout"
      title={translate('dashboardPopout.recoverableError.title', 'Orca dashboard hit an error.')}
      description={translate(
        'dashboardPopout.recoverableError.description',
        'The dashboard could not finish rendering. Retry to remount it, or reopen it.'
      )}
    >
      <DashboardPopoutRoot />
    </RecoverableRenderErrorBoundary>
  )
}

getOrCreateRendererRoot(rootElement, import.meta.hot?.data).render(
  <StrictMode>
    <I18nProvider>
      <CompanionWindowSettingsSync />
      <PopoutRoot />
    </I18nProvider>
  </StrictMode>
)
recordRendererCrashBreadcrumb('popout_bootstrap_rendered')
