// Install the import-free hook before react-dom reads it during evaluation; the observer below wraps a per-commit property and can load later.
import './diagnostics/react-commits/react-devtools-commit-hook-shim'
import './diagnostics/react-commits/react-commit-cascade-observer'
import './assets/main.css'

import { StrictMode, useEffect } from 'react'
import { DashboardPopoutRoot } from './components/dashboard-popout/DashboardPopoutRoot'
import { RecoverableRenderErrorBoundary } from './components/error-boundaries/RecoverableRenderErrorBoundary'
import { installRendererCrashDiagnostics } from './diagnostics/crash-reporting/crash-diagnostics'
import { recordRendererCrashBreadcrumb } from './diagnostics/crash-reporting/crash-breadcrumb-recorder'
import { I18nProvider } from './i18n/I18nProvider'
import { useTranslate } from './i18n/use-translate'
import { CompanionWindowSettingsSync } from './components/companion-window/CompanionWindowSettingsSync'
import { seedCompanionWindowSettings } from './components/companion-window/companion-window-appearance'
import { getOrCreateRendererRoot } from './app-shell/startup/react-renderer-root'
import { setReactCommitCascadeRendererSurface } from './diagnostics/react-commits/react-commit-cascade-telemetry'
import { installOsFileDropCancellationGuard } from './lib/files/drop/os-file-drop-cancellation-guard'
import { installBodyOverlayAttributes } from './lib/overlay-interaction/body-overlay-attributes'

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
  const t = useTranslate()
  useEffect(() => {
    document.title = t('auto.main.window.dashboard.popout.window.title', 'Orca Agent Dashboard')
  }, [t])
  return (
    <RecoverableRenderErrorBoundary
      boundaryId="dashboard-popout.root"
      surface="dashboard-popout"
      title={t('dashboardPopout.recoverableError.title', 'Orca dashboard hit an error.')}
      description={t(
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
