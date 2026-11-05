import { useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useAppMenuPaste } from '@/hooks/useAppMenuPaste'
import { useAppMenuSelectionActions } from '@/hooks/useAppMenuSelectionActions'
import { translate } from '@/i18n/i18n'
import type { WorkbenchTabView } from '../../../../shared/workbench-window/workbench-window-types'
import { WorkbenchTabStrip } from './WorkbenchTabStrip'
import { WorkbenchTerminalBody } from './WorkbenchTerminalBody'
import { WorkbenchEditorBody } from './WorkbenchEditorBody'
import { WorkbenchPaneHeaderActions, type WorkbenchPaneSide } from './workbench-pane-header-actions'
import { useWorkbenchWindowModel } from './use-workbench-window-model'

function WorkbenchTabBody({ tab }: { tab: WorkbenchTabView }): React.JSX.Element | null {
  if (tab.kind === 'terminal' && tab.terminal) {
    return <WorkbenchTerminalBody terminal={tab.terminal} />
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
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-2">
        <Select value={tab.tabId} onValueChange={onChoose}>
          <SelectTrigger size="sm" className="h-6 min-w-0 max-w-64">
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

  const windowTitle = translate('components.workbench.window.WorkbenchWindowRoot.title', 'Orca')
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
          activeTabId={activeTab?.tabId ?? null}
          splitEnabled={model.splitEnabled}
          onActivate={model.activate}
          onToggleSplit={model.toggleSplit}
        />
        {body}
      </div>
    </TooltipProvider>
  )
}
