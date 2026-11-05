import { Suspense } from 'react'
import { lazyWithRetry as lazy } from '@/lib/lazy-with-retry'
import { AgentHibernationGate } from '../components/AgentHibernationGate'
import { AiVaultTabTitleSyncGate } from '../components/AiVaultTabTitleSyncGate'
import RetainedAgentsSyncGate from '../components/dashboard/RetainedAgentsSyncGate'
import { WorkspacePortScanner } from '../components/ports/WorkspacePortScanner'
import { SavedHostScopeWidenGate } from '../components/sidebar/worktree-list/listing/SavedHostScopeWidenGate'
import { MacosTccPromptNoticeHost } from '../hooks/MacosTccPromptNoticeHost'
import { useAppStore } from '../store/index'
import { ActiveWorkspaceSyncGate } from './ActiveWorkspaceSyncGate'
import { StructuredAgentSessionAttentionBridge } from '../components/native-chat/StructuredAgentSessionAttentionBridge'
import { StructuredAgentSessionStatusBridge } from '../components/native-chat/StructuredAgentSessionStatusBridge'
import { NativeChatVisualGuestThemePublisher } from '../components/native-chat/NativeChatVisualGuestThemePublisher'

import { isPairedWebClientWindow } from '@/lib/desktop-window-chrome'

const DashboardPopoutBridge = lazy(() => import('../components/dashboard/DashboardPopoutBridge'))
const WorkbenchWindowBridge = lazy(
  () => import('../components/workbench-window/bridge/WorkbenchWindowBridge')
)
// Paired web clients cannot open native windows.
const workbenchWindowsAvailable = !isPairedWebClientWindow()

/** Isolate high-churn subscriptions from App rendering; services outlive their consuming surfaces. */
export function AppBackgroundServices(): React.JSX.Element {
  const workspaceSessionReady = useAppStore((s) => s.workspaceSessionReady)
  const dashboardPopoutEnabled = useAppStore(
    (s) => s.settings?.experimentalAgentDashboardPopout === true
  )

  return (
    <>
      <NativeChatVisualGuestThemePublisher />
      <WorkspacePortScanner enabled={workspaceSessionReady} />
      <ActiveWorkspaceSyncGate />
      {/* Keep permission notices available across app surfaces. */}
      <MacosTccPromptNoticeHost />
      {/* Keep agent-status retention subscriptions out of the App render tree. */}
      <RetainedAgentsSyncGate />
      <AiVaultTabTitleSyncGate />
      <SavedHostScopeWidenGate />
      {dashboardPopoutEnabled ? (
        <Suspense fallback={null}>
          <DashboardPopoutBridge />
        </Suspense>
      ) : null}
      {workbenchWindowsAvailable ? (
        <Suspense fallback={null}>
          <WorkbenchWindowBridge />
        </Suspense>
      ) : null}
      <AgentHibernationGate />
      <StructuredAgentSessionStatusBridge />
      {/* Background chats have no mounted pane but still need completion attention. */}
      <StructuredAgentSessionAttentionBridge />
    </>
  )
}
