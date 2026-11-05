/**
 * Which pane the Agent Graph panel shows. Standalone so menus can retarget the panel without
 * a persisted UI field; null means "follow the active terminal pane".
 */
import { create } from 'zustand'
import { useAppStore } from '@/store'

type AgentGraphTargetState = { paneKey: string | null }

export const useAgentGraphTargetStore = create<AgentGraphTargetState>(() => ({ paneKey: null }))

export function setAgentGraphTargetPane(paneKey: string | null): void {
  useAgentGraphTargetStore.setState({ paneKey })
}

export function openAgentGraphForPane(paneKey: string): void {
  setAgentGraphTargetPane(paneKey)
  const state = useAppStore.getState()
  state.setRightSidebarTab('agent-graph')
  state.setRightSidebarOpen(true)
}
