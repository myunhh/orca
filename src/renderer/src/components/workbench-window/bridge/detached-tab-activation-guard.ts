import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import type { TabGroup } from '../../../../../shared/tab-types'
import { mainStripSuccessor } from '../workbench-tab-move'

type GuardAction = { kind: 'return'; tabId: string } | { kind: 'select'; tabId: string }

function guardActionFor(
  state: AppState,
  group: TabGroup,
  before: TabGroup | undefined
): GuardAction | null {
  const tabId = group.activeTabId
  if (!tabId || state.detachedWindowIdByTabId[tabId] === undefined) {
    return null
  }
  if (!before || before.activeTabId === tabId) {
    return null
  }
  const previous = before.activeTabId
  const previousStays =
    previous !== null &&
    group.tabOrder.includes(previous) &&
    state.detachedWindowIdByTabId[previous] === undefined
  // A detached tab moved in, or its predecessor closed: the selection was incidental, not a request to show it here.
  if (!before.tabOrder.includes(tabId) || !previousStays) {
    const successor = previousStays ? previous : mainStripSuccessor(state, group, tabId)
    return successor ? { kind: 'select', tabId: successor } : null
  }
  return { kind: 'return', tabId }
}

/** Activating a detached tab from the main window (explorer, reveal, notification) brings it back there. */
export function watchDetachedTabActivation(): () => void {
  return useAppStore.subscribe((state, previous) => {
    if (
      state.groupsByWorktree === previous.groupsByWorktree ||
      Object.keys(state.detachedWindowIdByTabId).length === 0
    ) {
      return
    }
    const actions: GuardAction[] = []
    for (const [worktreeId, groups] of Object.entries(state.groupsByWorktree)) {
      const previousGroups = previous.groupsByWorktree[worktreeId]
      if (groups === previousGroups) {
        continue
      }
      for (const group of groups) {
        const before = previousGroups?.find((candidate) => candidate.id === group.id)
        const action = guardActionFor(state, group, before)
        if (action) {
          actions.push(action)
        }
      }
    }
    for (const action of actions) {
      if (action.kind === 'return') {
        useAppStore.getState().returnTabToMainWindow(action.tabId)
      } else {
        useAppStore
          .getState()
          .activateTab(action.tabId, { recordFocus: false, preservePreview: true })
      }
    }
  })
}
