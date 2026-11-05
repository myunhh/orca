import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import type { TerminalContextShareTarget } from './terminal-context-share-targets'
import type { TerminalContextSharePreferredTarget } from './terminal-context-share-request'

export function firstSelectableTargetKey(
  targets: TerminalContextShareTarget[],
  preferred?: TerminalContextSharePreferredTarget
): string | null {
  const selectable = targets.filter((target) => target.agentLabel !== null)
  const match = preferred
    ? selectable.find(
        (target) =>
          target.tabId === preferred.tabId &&
          (preferred.leafId === null || target.leafId === preferred.leafId)
      )
    : undefined
  return (match ?? selectable[0])?.key ?? null
}

export function TerminalTargetSelect({
  id,
  targets,
  value,
  disabled,
  onChange
}: {
  id: string
  targets: TerminalContextShareTarget[]
  value: string | null
  disabled?: boolean
  onChange: (key: string) => void
}): React.JSX.Element {
  return (
    <Select value={value ?? undefined} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue
          placeholder={translate(
            'components.terminalContextShare.targetPlaceholder',
            'Choose a terminal'
          )}
        />
      </SelectTrigger>
      <SelectContent position="popper">
        {targets.map((target) => (
          // Guarded sends refuse terminals without an agent, so plain shells are shown but not selectable.
          <SelectItem key={target.key} value={target.key} disabled={!target.agentLabel}>
            <span className="min-w-0 truncate">{target.title}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {`${target.worktreeLabel} · ${
                target.agentLabel ??
                translate('components.terminalContextShare.targetNoAgent', 'No agent')
              }`}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
