import { useMemo, useState } from 'react'
import { defaultFilter } from 'cmdk'
import { ListPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslate } from '@/i18n/use-translate'
import type { WorkbenchAdoptableTab } from '../../../../shared/workbench-window/workbench-window-types'
import { WorkbenchTabIcon } from './WorkbenchTabIcon'

type AdoptableGroup = { worktreeId: string; heading: string; tabs: WorkbenchAdoptableTab[] }

// Worktree names like "main" repeat across repos; the repo tells them apart.
function workspaceHeading(tab: WorkbenchAdoptableTab): string {
  return tab.repoLabel ? `${tab.repoLabel} / ${tab.worktreeLabel}` : tab.worktreeLabel
}

/** One group per workspace, in the order the main window lists them. */
function groupByWorkspace(adoptableTabs: readonly WorkbenchAdoptableTab[]): AdoptableGroup[] {
  const groups = new Map<string, AdoptableGroup>()
  for (const tab of adoptableTabs) {
    const group = groups.get(tab.worktreeId)
    if (group) {
      group.tabs.push(tab)
    } else {
      groups.set(tab.worktreeId, {
        worktreeId: tab.worktreeId,
        heading: workspaceHeading(tab),
        tabs: [tab]
      })
    }
  }
  return [...groups.values()]
}

// Item values are tab ids for identity; score only what the user can read.
function filterByVisibleText(_value: string, search: string, keywords?: string[]): number {
  return defaultFilter('', search, keywords)
}

/** Pull a tab that is open in the main window into this one, e.g. a second running agent. */
export function WorkbenchAdoptTabButton({
  adoptableTabs,
  truncated,
  splitEnabled,
  onAdopt
}: {
  adoptableTabs: readonly WorkbenchAdoptableTab[]
  truncated: boolean
  splitEnabled: boolean
  onAdopt: (tabId: string) => void
}): React.JSX.Element {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const groups = useMemo(() => groupByWorkspace(adoptableTabs), [adoptableTabs])
  const label = t(
    'components.workbench.window.WorkbenchAdoptTabButton.addExisting',
    'Add Existing Tab…'
  )
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label={label}>
              <ListPlus />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          {label}
        </TooltipContent>
      </Tooltip>
      <PopoverContent align="start" wheelScroll className="w-[min(20rem,calc(100vw-1rem))]">
        <Command density="menu" label={label} filter={filterByVisibleText}>
          <CommandInput
            placeholder={t(
              'components.workbench.window.WorkbenchAdoptTabButton.search',
              'Search main window tabs…'
            )}
          />
          {splitEnabled ? (
            <div className="border-b border-border px-3 py-1.5 text-2xs text-muted-foreground">
              {t(
                'components.workbench.window.WorkbenchAdoptTabButton.splitHint',
                'The tab opens in the right half of the split.'
              )}
            </div>
          ) : null}
          <CommandList className="max-h-72">
            <CommandEmpty>
              {adoptableTabs.length === 0
                ? t(
                    'components.workbench.window.WorkbenchAdoptTabButton.empty',
                    'No other tabs are open in the main window.'
                  )
                : t(
                    'components.workbench.window.WorkbenchAdoptTabButton.noMatches',
                    'No matching tabs'
                  )}
            </CommandEmpty>
            {groups.map((group) => (
              <CommandGroup key={group.worktreeId} heading={group.heading}>
                {group.tabs.map((tab) => (
                  <CommandItem
                    key={tab.tabId}
                    value={tab.tabId}
                    keywords={[tab.label, tab.worktreeLabel, tab.repoLabel ?? '']}
                    selection="palette"
                    onSelect={() => {
                      setOpen(false)
                      onAdopt(tab.tabId)
                    }}
                  >
                    <WorkbenchTabIcon
                      kind={tab.kind}
                      agentState={tab.agentState}
                      isImage={tab.isImage}
                    />
                    <span className="min-w-0 truncate">{tab.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
          {truncated ? (
            <div className="border-t border-border px-3 py-1.5 text-2xs text-muted-foreground">
              {t(
                'components.workbench.window.WorkbenchAdoptTabButton.truncated',
                'Only the first {{count}} tabs are listed.',
                { count: adoptableTabs.length }
              )}
            </div>
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  )
}
