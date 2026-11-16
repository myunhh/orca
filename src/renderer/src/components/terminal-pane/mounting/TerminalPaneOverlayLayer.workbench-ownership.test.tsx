// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Tab } from '../../../../../shared/tab-types'
import type { TerminalTab } from '../../../../../shared/workspace-layout/terminal-tab-types'
import { useAppStore } from '@/store'
import { registerTabGroupBody } from '../../tab-group/tab-group-body-geometry'
import TerminalPaneOverlayLayer from './TerminalPaneOverlayLayer'

vi.mock('../../native-chat/pane/routing/use-native-chat-toggle-shortcut', () => ({
  useNativeChatToggleShortcut: () => {}
}))
vi.mock('../parking/lifecycle/use-terminal-tab-cold-parking', () => ({
  useTerminalTabColdParking: () => new Set()
}))
vi.mock('../TerminalPane', () => ({
  default: ({ tabId }: { tabId: string }) => <input aria-label={tabId} defaultValue="prompt" />
}))

const initial = useAppStore.getInitialState()
const WORKTREE_ID = 'folder-workspace'
let unregisterBody: () => void
let body: HTMLDivElement

function terminalTab(id: string): TerminalTab {
  return {
    id,
    worktreeId: WORKTREE_ID,
    ptyId: null,
    title: id,
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 0,
    generation: 0
  }
}

function unifiedTab(id: string): Tab {
  return {
    id: `unified-${id}`,
    entityId: id,
    worktreeId: WORKTREE_ID,
    groupId: 'main-group',
    contentType: 'terminal',
    label: id,
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: 0
  }
}

beforeEach(() => {
  vi.stubGlobal('__ORCA_WEB_CLIENT__', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
  )
  useAppStore.setState(initial, true)
  useAppStore.setState({
    activeGroupIdByWorktree: { [WORKTREE_ID]: 'main-group' },
    groupsByWorktree: {
      [WORKTREE_ID]: [
        {
          id: 'main-group',
          worktreeId: WORKTREE_ID,
          activeTabId: 'unified-detached',
          tabOrder: ['unified-detached', 'unified-other']
        }
      ]
    },
    tabsByWorktree: { [WORKTREE_ID]: [terminalTab('detached'), terminalTab('other')] },
    unifiedTabsByWorktree: { [WORKTREE_ID]: [unifiedTab('detached'), unifiedTab('other')] }
  })
  body = document.createElement('div')
  body.getBoundingClientRect = () => new DOMRect(0, 32, 800, 568)
  document.body.append(body)
  unregisterBody = registerTabGroupBody('main-group', body)
})

afterEach(() => {
  cleanup()
  unregisterBody()
  body.remove()
  useAppStore.setState(initial, true)
  vi.unstubAllGlobals()
})

it('hides a detached terminal from its prior space across main selections and restores its live content on return', () => {
  const view = render(
    <TerminalPaneOverlayLayer worktreeId={WORKTREE_ID} worktreePath="/workspace" isWorktreeActive />
  )
  const input = view.getByRole('textbox', { name: 'detached' })
  fireEvent.change(input, { target: { value: 'unfinished command' } })

  act(() => useAppStore.getState().assignTabsToWorkbenchWindow(['unified-detached'], 'window-2'))
  expect(view.queryByRole('textbox', { name: 'detached' })).toBeNull()
  expect(view.container.contains(input)).toBe(true)

  act(() => {
    useAppStore.setState({
      groupsByWorktree: {
        [WORKTREE_ID]: [
          {
            id: 'main-group',
            worktreeId: WORKTREE_ID,
            activeTabId: 'unified-other',
            tabOrder: ['unified-detached', 'unified-other']
          }
        ]
      }
    })
  })
  expect(view.getByRole('textbox', { name: 'other' })).toBeTruthy()
  expect(view.queryByRole('textbox', { name: 'detached' })).toBeNull()

  act(() => {
    useAppStore.getState().returnTabToMainWindow('unified-detached')
    useAppStore.setState({
      groupsByWorktree: {
        [WORKTREE_ID]: [
          {
            id: 'main-group',
            worktreeId: WORKTREE_ID,
            activeTabId: 'unified-detached',
            tabOrder: ['unified-detached', 'unified-other']
          }
        ]
      }
    })
  })
  expect(view.getByRole('textbox', { name: 'detached' })).toBe(input)
  expect(view.getByDisplayValue('unfinished command')).toBe(input)
})
