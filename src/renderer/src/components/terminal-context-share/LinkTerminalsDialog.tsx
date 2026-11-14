import { useId, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { useTranslate } from '@/i18n/use-translate'
import type {
  TerminalContextSharePreferredTarget,
  TerminalContextShareSource
} from './terminal-context-share-request'
import {
  TerminalContextShareDialogShell,
  type TerminalContextShareReadyEndpoints
} from './TerminalContextShareDialogShell'
import { firstSelectableTargetKey, TerminalTargetSelect } from './TerminalTargetSelect'
import { buildTerminalLinkNote } from './terminal-context-share-messages'
import { deliverTextToTerminal } from './terminal-context-share-delivery'

export default function LinkTerminalsDialog({
  source,
  preferredTarget,
  onClose
}: {
  source: TerminalContextShareSource
  preferredTarget?: TerminalContextSharePreferredTarget
  onClose: () => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <TerminalContextShareDialogShell
      source={source}
      sameRuntimeOnly
      title={t('components.terminalContextShare.linkTitle', 'Link Terminals')}
      description={t(
        'components.terminalContextShare.linkDescription',
        'Tell the agents in “{{source}}” and a partner terminal how to read and type into each other’s terminal with the orca CLI.',
        { source: source.title }
      )}
      onClose={onClose}
    >
      {(endpoints) => (
        <LinkTerminalsForm
          source={source}
          preferredTarget={preferredTarget}
          endpoints={endpoints}
          onClose={onClose}
        />
      )}
    </TerminalContextShareDialogShell>
  )
}

function LinkTerminalsForm({
  source,
  preferredTarget,
  endpoints,
  onClose
}: {
  source: TerminalContextShareSource
  preferredTarget?: TerminalContextSharePreferredTarget
  endpoints: TerminalContextShareReadyEndpoints
  onClose: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const ids = useId()
  const [partnerKey, setPartnerKey] = useState<string | null>(() =>
    firstSelectableTargetKey(endpoints.targets, preferredTarget)
  )
  // Endpoints whose note already landed for the current partner; a retry must not re-prompt them.
  const [delivered, setDelivered] = useState<{ source: boolean; partner: boolean }>({
    source: false,
    partner: false
  })
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const partner = endpoints.targets.find((candidate) => candidate.key === partnerKey) ?? null
  const self = { title: source.title, handle: endpoints.sourceHandle }

  const link = async (): Promise<void> => {
    if (!partner) {
      return
    }
    setSending(true)
    setError(null)
    const partnerRef = { title: partner.title, handle: partner.handle }
    const toSource = delivered.source
      ? { ok: true as const }
      : await deliverTextToTerminal(
          endpoints.sourceRuntimeTarget,
          endpoints.sourceHandle,
          buildTerminalLinkNote({ self, partner: partnerRef })
        )
    // Without the source's note the partner would be told about a link that does not exist.
    const toPartner =
      !toSource.ok || delivered.partner
        ? toSource
        : await deliverTextToTerminal(
            partner.runtimeTarget,
            partner.handle,
            buildTerminalLinkNote({ self: partnerRef, partner: self })
          )
    setSending(false)
    setDelivered({ source: toSource.ok, partner: toSource.ok && toPartner.ok })
    if (toSource.ok && toPartner.ok) {
      toast.success(
        t('components.terminalContextShare.linked', 'Linked “{{source}}” with “{{target}}”.', {
          source: source.title,
          target: partner.title
        })
      )
      onClose()
      return
    }
    const failure = !toSource.ok ? toSource.message : !toPartner.ok ? toPartner.message : ''
    setError(
      t(
        'components.terminalContextShare.linkPartial',
        'Not every agent received its note: {{reason}}',
        { reason: failure }
      )
    )
  }

  return (
    <>
      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor={`${ids}-partner`}>
            {t('components.terminalContextShare.partnerLabel', 'Partner terminal')}
          </Label>
          <TerminalTargetSelect
            id={`${ids}-partner`}
            terminals={endpoints.targets}
            value={partnerKey}
            disabled={sending}
            onChange={(key) => {
              setPartnerKey(key)
              setDelivered({ source: false, partner: false })
            }}
          />
        </div>
        {partner ? (
          <div className="grid gap-2">
            <Label>
              {t('components.terminalContextShare.linkPreviewLabel', 'Note sent to each agent')}
            </Label>
            <pre className="scrollbar-sleek max-h-56 overflow-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {buildTerminalLinkNote({
                self,
                partner: { title: partner.title, handle: partner.handle }
              })}
            </pre>
            <p className="text-xs text-muted-foreground">
              {t(
                'components.terminalContextShare.linkWarning',
                'Both agents will be able to read and type into each other’s terminal. Only link agents you trust to act on each other’s output.'
              )}
            </p>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('components.terminalContextShare.cancel', 'Cancel')}
        </Button>
        <Button type="button" disabled={sending || !partner} onClick={() => void link()}>
          {sending ? <Loader2 className="size-4 animate-spin" /> : null}
          {t('components.terminalContextShare.linkSubmit', 'Send Link Notes')}
        </Button>
      </DialogFooter>
    </>
  )
}
