import { useCallback, useEffect, useReducer } from 'react'
import type {
  WorkbenchSnapshot,
  WorkbenchTabView
} from '../../../../shared/workbench-window/workbench-window-types'

type WorkbenchWindowModelState = {
  snapshot: WorkbenchSnapshot | null
  selectedTabId: string | null
  secondaryTabId: string | null
  splitEnabled: boolean
  /** Once a tab arrived, an empty view means every tab left and the window can close. */
  hadTabs: boolean
}

type WorkbenchWindowModelAction =
  | { type: 'snapshot'; snapshot: WorkbenchSnapshot }
  | { type: 'activate'; tabId: string }
  | { type: 'setSecondary'; tabId: string }
  | { type: 'toggleSplit' }

const INITIAL_STATE: WorkbenchWindowModelState = {
  snapshot: null,
  selectedTabId: null,
  secondaryTabId: null,
  splitEnabled: false,
  hadTabs: false
}

function otherTabId(tabs: readonly WorkbenchTabView[], excluded: string | null): string | null {
  return tabs.find((tab) => tab.tabId !== excluded)?.tabId ?? null
}

function withSecondary(state: WorkbenchWindowModelState): WorkbenchWindowModelState {
  const tabs = state.snapshot?.tabs ?? []
  const keep =
    state.secondaryTabId !== state.selectedTabId &&
    tabs.some((tab) => tab.tabId === state.secondaryTabId)
  return keep ? state : { ...state, secondaryTabId: otherTabId(tabs, state.selectedTabId) }
}

function reduce(
  state: WorkbenchWindowModelState,
  action: WorkbenchWindowModelAction
): WorkbenchWindowModelState {
  switch (action.type) {
    case 'snapshot': {
      const tabs = action.snapshot.tabs
      const previousIds = new Set(state.snapshot?.tabs.map((tab) => tab.tabId) ?? [])
      // A tab that just arrived (new terminal, another move) takes focus, as a new browser tab does.
      const arrived = state.snapshot ? tabs.filter((tab) => !previousIds.has(tab.tabId)) : []
      const activeStillShown = tabs.some((tab) => tab.tabId === state.selectedTabId)
      const selectedTabId =
        arrived.at(-1)?.tabId ?? (activeStillShown ? state.selectedTabId : (tabs[0]?.tabId ?? null))
      return withSecondary({
        ...state,
        snapshot: action.snapshot,
        selectedTabId,
        hadTabs: state.hadTabs || tabs.length > 0
      })
    }
    case 'activate':
      return withSecondary({ ...state, selectedTabId: action.tabId })
    case 'setSecondary':
      return { ...state, secondaryTabId: action.tabId }
    case 'toggleSplit':
      return withSecondary({ ...state, splitEnabled: !state.splitEnabled })
  }
}

export type WorkbenchWindowModel = WorkbenchWindowModelState & {
  activate: (tabId: string) => void
  setSecondary: (tabId: string) => void
  toggleSplit: () => void
}

/** Local view state of one workbench window; tab ownership stays in the main window. */
export function useWorkbenchWindowModel(): WorkbenchWindowModel {
  const [state, dispatch] = useReducer(reduce, INITIAL_STATE)
  useEffect(() => {
    const api = window.api.workbenchWindows
    if (!api) {
      return
    }
    const off = api.onSnapshot((snapshot) => dispatch({ type: 'snapshot', snapshot }))
    void api.requestSnapshot()
    return off
  }, [])
  const isEmpty = state.snapshot?.tabs.length === 0 && state.snapshot.pendingTabCount === 0
  useEffect(() => {
    // Like a browser window whose last tab moved out.
    if (state.hadTabs && isEmpty) {
      window.close()
    }
  }, [state.hadTabs, isEmpty])
  const activate = useCallback((tabId: string) => dispatch({ type: 'activate', tabId }), [])
  const setSecondary = useCallback((tabId: string) => dispatch({ type: 'setSecondary', tabId }), [])
  const toggleSplit = useCallback(() => dispatch({ type: 'toggleSplit' }), [])
  return { ...state, activate, setSecondary, toggleSplit }
}
