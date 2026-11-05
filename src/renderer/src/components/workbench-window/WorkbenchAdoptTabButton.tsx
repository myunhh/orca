import { useMemo, useState } from 'react'
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
import { translate } from '@/i18n/i18n'
import type { WorkbenchAdoptableTab } from '../../../../shared/workbench-window/workbench-window-types'
import { WorkbenchTabIcon } from './WorkbenchTabIcon'

type AdoptableGroup = { key: string; worktreeLabel: string; tabs: WorkbenchAdoptableTab[] }

/** Consecutive runs: the main window lists tabs workspace by workspace, and labels can repeat across repos. */
function groupByWorkspace(adoptableTabs: readonly WorkbenchAdoptableTab[]): AdoptableGroup[] {
  const groups: AdoptableGroup[] = []
  for (const tab of adoptableTabs) {
    const last = groups.at(-1)
    if (last && last.worktreeLabel === tab.worktreeLabel) {
      last.tabs.push(tab)
    } else {
      groups.push({ key: tab.tabId, worktreeLabel: tab.worktreeLabel, tabs: [tab] })
    }
  }
  return groups
}

/** Pull a tab that is open in the main window into this one, e.g. a second running agent. */
export function WorkbenchAdoptTabButton({
  adoptableTabs,
  splitEnabled,
  onAdopt
}: {
  adoptableTabs: readonly WorkbenchAdoptableTab[]
  splitEnabled: boolean
  onAdopt: (tabId: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const groups = useMemo(() => groupByWorkspace(adoptableTabs), [adoptableTabs])
  const label = translate(
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
        <Command density="menu" label={label}>
          <CommandInput
            placeholder={translate(
              'components.workbench.window.WorkbenchAdoptTabButton.search',
              'Search main window tabs…'
            )}
          />
          {splitEnabled ? (
            <div className="border-b border-border px-3 py-1.5 text-2xs text-muted-foreground">
              {translate(
                'components.workbench.window.WorkbenchAdoptTabButton.splitHint',
                'The tab opens in the right half of the split.'
              )}
            </div>
          ) : null}
          <CommandList className="max-h-72">
            <CommandEmpty>
              {translate(
                'components.workbench.window.WorkbenchAdoptTabButton.empty',
                'No other tabs are open in the main window.'
              )}
            </CommandEmpty>
            {groups.map((group) => (
              <CommandGroup key={group.key} heading={group.worktreeLabel}>
                {group.tabs.map((tab) => (
                  <CommandItem
                    key={tab.tabId}
                    value={tab.tabId}
                    keywords={[tab.label, tab.worktreeLabel]}
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
        </Command>
      </PopoverContent>
    </Popover>
  )
}
