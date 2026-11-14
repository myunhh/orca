import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useTranslate } from '@/i18n/use-translate'
import type { TerminalContextShareTarget } from './terminal-context-share-targets'
import type { TerminalContextSharePreferredTarget } from './terminal-context-share-request'

export function firstSelectableTargetKey(
  targets: TerminalContextShareTarget[],
  preferred?: TerminalContextSharePreferredTarget
): string | null {
  const selectable = targets.filter((target) => target.agentLabel !== null)
  if (!preferred) {
    return selectable[0]?.key ?? null
  }
  const sameTab = selectable.filter((target) => target.tabId === preferred.tabId)
  // A named partner that cannot be matched leaves the choice to the user, never an unrelated agent.
  return (sameTab.find((target) => target.leafId === preferred.leafId) ?? sameTab[0])?.key ?? null
}

export function TerminalTargetSelect({
  id,
  terminals,
  value,
  disabled,
  onChange
}: {
  id: string
  terminals: TerminalContextShareTarget[]
  value: string | null
  disabled?: boolean
  onChange: (key: string) => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <Select value={value ?? undefined} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue
          placeholder={t('components.terminalContextShare.targetPlaceholder', 'Choose a terminal')}
        />
      </SelectTrigger>
      <SelectContent position="popper">
        {terminals.map((terminal) => (
          // Guarded sends refuse terminals without an agent, so plain shells are shown but not selectable.
          <SelectItem key={terminal.key} value={terminal.key} disabled={!terminal.agentLabel}>
            <span className="min-w-0 truncate">{terminal.title}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {`${terminal.worktreeLabel} · ${
                terminal.agentLabel ??
                t('components.terminalContextShare.targetNoAgent', 'No agent')
              }`}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
