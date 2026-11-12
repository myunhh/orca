import { useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useAppMenuPaste } from '@/hooks/clipboard/menu/useAppMenuPaste'
import { useAppMenuSelectionActions } from '@/hooks/app-commands/useAppMenuSelectionActions'
import { translate } from '@/i18n/i18n'
import type {
  WorkbenchAdoptableTab,
  WorkbenchTabView
} from '../../../../shared/workbench-window/workbench-window-types'
import { WorkbenchTabStrip } from './WorkbenchTabStrip'
import { WorkbenchTerminalBody } from './WorkbenchTerminalBody'
import { WorkbenchEditorBody } from './WorkbenchEditorBody'
import { WorkbenchPaneHeaderActions, type WorkbenchPaneSide } from './workbench-pane-header-actions'
import { useWorkbenchWindowModel } from './use-workbench-window-model'

const NO_ADOPTABLE_TABS: readonly WorkbenchAdoptableTab[] = []

// Display-only: main assigns it so the main window's "Move to Window" names match this title.
function readWindowOrdinal(): number | null {
  const ordinal = Number(new URLSearchParams(window.location.search).get('ordinal'))
  return Number.isSafeInteger(ordinal) && ordinal > 0 ? ordinal : null
}

const WINDOW_ORDINAL = readWindowOrdinal()

function WorkbenchTabBody({ tab }: { tab: WorkbenchTabView }): React.JSX.Element | null {
  if (tab.kind === 'terminal' && tab.terminal) {
    return <WorkbenchTerminalBody tabId={tab.tabId} terminal={tab.terminal} />
  }
  return <WorkbenchEditorBody tab={tab} />
}

function WorkbenchSplitPane({
  tab,
  side,
  partner,
  choices,
  onChoose
}: {
  tab: WorkbenchTabView
  side: WorkbenchPaneSide
  partner: WorkbenchTabView | null
  choices: readonly WorkbenchTabView[]
  onChoose: (tabId: string) => void
}): React.JSX.Element {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2">
        <Select value={tab.tabId} onValueChange={onChoose}>
          <SelectTrigger size="sm" density="compact" className="min-w-0 max-w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {choices.map((choice) => (
              <SelectItem key={choice.tabId} value={choice.tabId}>
                {choice.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
          {tab.worktreeLabel}
        </span>
        <WorkbenchPaneHeaderActions tab={tab} side={side} partner={partner} />
      </div>
      <WorkbenchTabBody key={tab.tabId} tab={tab} />
    </div>
  )
}

/** A detached window: a Chrome-like strip over main-owned tabs, with an optional side-by-side split. */
export function WorkbenchWindowRoot(): React.JSX.Element {
  // No App shell here translates Edit-menu IPC into terminal ownership events.
  useAppMenuPaste()
  useAppMenuSelectionActions()
  const model = useWorkbenchWindowModel()
  const tabs = model.snapshot?.tabs ?? []
  const activeTab = tabs.find((tab) => tab.tabId === model.selectedTabId) ?? null
  const secondaryTab =
    model.splitEnabled && activeTab
      ? (tabs.find((tab) => tab.tabId === model.secondaryTabId) ?? null)
      : null

  // The main window runs this window's commands; their failures show here, where the user acted.
  useEffect(
    () => window.api.workbenchWindows?.onNotice((notice) => toast.error(notice.message)),
    []
  )

  const appTitle = translate('components.workbench.window.WorkbenchWindowRoot.title', 'Orca')
  const windowName =
    WINDOW_ORDINAL === null
      ? null
      : translate(
          'components.workbench.window.WorkbenchWindowRoot.windowName',
          'Window {{windowNumber}}',
          { windowNumber: WINDOW_ORDINAL }
        )
  const windowTitle = windowName ? `${windowName} — ${appTitle}` : appTitle
  useEffect(() => {
    document.title = activeTab ? `${activeTab.label} — ${windowTitle}` : windowTitle
  }, [activeTab, windowTitle])

  let body: React.JSX.Element
  if (!model.snapshot) {
    body = (
      <div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {translate(
          'components.workbench.window.WorkbenchWindowRoot.loading',
          'Connecting to Orca…'
        )}
      </div>
    )
  } else if (!activeTab) {
    body = (
      <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
        {translate(
          'components.workbench.window.WorkbenchWindowRoot.empty',
          'No tabs in this window'
        )}
      </div>
    )
  } else if (secondaryTab) {
    body = (
      <div className="flex min-h-0 min-w-0 flex-1 divide-x divide-border">
        <WorkbenchSplitPane
          tab={activeTab}
          side="primary"
          partner={secondaryTab}
          choices={tabs.filter((tab) => tab.tabId !== secondaryTab.tabId)}
          onChoose={model.activate}
        />
        <WorkbenchSplitPane
          tab={secondaryTab}
          side="secondary"
          partner={activeTab}
          choices={tabs.filter((tab) => tab.tabId !== activeTab.tabId)}
          onChoose={model.setSecondary}
        />
      </div>
    )
  } else {
    body = <WorkbenchTabBody key={activeTab.tabId} tab={activeTab} />
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
        <WorkbenchTabStrip
          tabs={tabs}
          adoptableTabs={model.snapshot?.adoptableTabs ?? NO_ADOPTABLE_TABS}
          adoptableTabsTruncated={model.snapshot?.adoptableTabsTruncated ?? false}
          activeTabId={activeTab?.tabId ?? null}
          splitEnabled={model.splitEnabled}
          onActivate={model.activate}
          onAdopt={model.adopt}
          onToggleSplit={model.toggleSplit}
        />
        {body}
      </div>
    </TooltipProvider>
  )
}
