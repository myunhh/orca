import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import type { TerminalContextShareTarget } from './terminal-context-share-targets'

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
          <SelectItem key={target.key} value={target.key}>
            <span className="min-w-0 truncate">{target.title}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {target.agentLabel
                ? `${target.worktreeLabel} · ${target.agentLabel}`
                : target.worktreeLabel}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
