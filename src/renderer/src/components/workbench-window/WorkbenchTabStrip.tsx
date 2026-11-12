import { AppWindow, Columns2, Plus, Undo2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  ACTIVE_TAB_INDICATOR_CLASSES,
  getTabRootStateClasses
} from '@/components/tab-bar/drop-indicator'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/class-names'
import type {
  WorkbenchAdoptableTab,
  WorkbenchTabView
} from '../../../../shared/workbench-window/workbench-window-types'
import { sendWorkbenchCommand } from './workbench-window-commands'
import { WorkbenchTabIcon } from './WorkbenchTabIcon'
import { WorkbenchAdoptTabButton } from './WorkbenchAdoptTabButton'

function WorkbenchTab({
  tab,
  isActive,
  hasTabsToRight,
  onActivate
}: {
  tab: WorkbenchTabView
  isActive: boolean
  hasTabsToRight: boolean
  onActivate: (tabId: string) => void
}): React.JSX.Element {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="tab"
          aria-selected={isActive}
          tabIndex={0}
          data-workbench-tab-id={tab.tabId}
          className={cn(
            'group relative flex h-full min-w-0 max-w-56 shrink-0 cursor-pointer select-none items-center gap-1.5 border-r border-border pl-2.5 pr-1 text-xs outline-none',
            !hasTabsToRight && 'border-r-transparent',
            getTabRootStateClasses(isActive)
          )}
          onClick={() => onActivate(tab.tabId)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onActivate(tab.tabId)
            }
          }}
          onAuxClick={(event) => {
            if (event.button === 1) {
              event.preventDefault()
              sendWorkbenchCommand({ kind: 'closeTab', tabId: tab.tabId })
            }
          }}
        >
          {isActive ? <span className={ACTIVE_TAB_INDICATOR_CLASSES} aria-hidden /> : null}
          <WorkbenchTabIcon
            kind={tab.kind}
            agentState={tab.agentState}
            isImage={tab.editor?.isImage ?? false}
          />
          <span className="min-w-0 truncate">{tab.label}</span>
          <Button
            variant="ghost"
            size="icon-xs"
            className="ml-0.5 shrink-0"
            aria-label={translate(
              'components.workbench.window.WorkbenchTabStrip.closeTab',
              'Close Tab'
            )}
            onClick={(event) => {
              event.stopPropagation()
              sendWorkbenchCommand({ kind: 'closeTab', tabId: tab.tabId })
            }}
          >
            <X />
          </Button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onSelect={() => sendWorkbenchCommand({ kind: 'returnTab', tabId: tab.tabId })}
        >
          <Undo2 className="size-3.5 shrink-0" />
          {translate(
            'components.workbench.window.WorkbenchTabStrip.returnToMain',
            'Return to Main Window'
          )}
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => sendWorkbenchCommand({ kind: 'revealInMain', tabId: tab.tabId })}
        >
          <AppWindow className="size-3.5 shrink-0" />
          {translate(
            'components.workbench.window.WorkbenchTabStrip.openInMain',
            'Open in Main Window'
          )}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => sendWorkbenchCommand({ kind: 'closeTab', tabId: tab.tabId })}
        >
          <X className="size-3.5 shrink-0" />
          {translate('components.workbench.window.WorkbenchTabStrip.close', 'Close')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function WorkbenchTabStrip({
  tabs,
  adoptableTabs,
  adoptableTabsTruncated,
  activeTabId,
  splitEnabled,
  onActivate,
  onAdopt,
  onToggleSplit
}: {
  tabs: readonly WorkbenchTabView[]
  adoptableTabs: readonly WorkbenchAdoptableTab[]
  adoptableTabsTruncated: boolean
  activeTabId: string | null
  splitEnabled: boolean
  onActivate: (tabId: string) => void
  onAdopt: (tabId: string) => void
  onToggleSplit: () => void
}): React.JSX.Element {
  const activeTab = tabs.find((tab) => tab.tabId === activeTabId) ?? tabs[0] ?? null
  const newTerminalLabel = translate(
    'components.workbench.window.WorkbenchTabStrip.newTerminal',
    'New Terminal'
  )
  const splitLabel = translate(
    'components.workbench.window.WorkbenchTabStrip.splitView',
    'Split View'
  )
  return (
    <div className="flex h-9 shrink-0 items-stretch border-b border-border bg-tab-bar">
      <div
        role="tablist"
        className="scrollbar-sleek flex min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden"
      >
        {tabs.map((tab, index) => (
          <WorkbenchTab
            key={tab.tabId}
            tab={tab}
            isActive={tab.tabId === activeTab?.tabId}
            hasTabsToRight={index < tabs.length - 1}
            onActivate={onActivate}
          />
        ))}
        <div className="flex shrink-0 items-center gap-0.5 px-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={newTerminalLabel}
                disabled={!activeTab}
                onClick={() =>
                  activeTab &&
                  sendWorkbenchCommand({ kind: 'newTerminal', worktreeId: activeTab.worktreeId })
                }
              >
                <Plus />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>
              {newTerminalLabel}
            </TooltipContent>
          </Tooltip>
          <WorkbenchAdoptTabButton
            adoptableTabs={adoptableTabs}
            truncated={adoptableTabsTruncated}
            splitEnabled={splitEnabled}
            onAdopt={onAdopt}
          />
        </div>
      </div>
      <div className="flex shrink-0 items-center px-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={splitEnabled ? 'secondary' : 'ghost'}
              size="icon-xs"
              aria-label={splitLabel}
              aria-pressed={splitEnabled}
              disabled={tabs.length < 2 && !splitEnabled}
              onClick={onToggleSplit}
            >
              <Columns2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            {splitLabel}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
