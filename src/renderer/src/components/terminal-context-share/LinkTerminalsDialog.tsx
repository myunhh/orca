import { useId, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import type { TerminalContextShareSource } from './terminal-context-share-request'
import {
  TerminalContextShareDialogShell,
  type TerminalContextShareReadyEndpoints
} from './TerminalContextShareDialogShell'
import { TerminalTargetSelect } from './TerminalTargetSelect'
import { buildTerminalLinkNote } from './terminal-context-share-messages'
import { deliverTextToTerminal } from './terminal-context-share-delivery'

export default function LinkTerminalsDialog({
  source,
  onClose
}: {
  source: TerminalContextShareSource
  onClose: () => void
}): React.JSX.Element {
  return (
    <TerminalContextShareDialogShell
      source={source}
      title={translate('components.terminalContextShare.linkTitle', 'Link Terminals')}
      description={translate(
        'components.terminalContextShare.linkDescription',
        'Tell the agents in “{{source}}” and a partner terminal how to read and type into each other’s terminal with the orca CLI.',
        { source: source.title }
      )}
      onClose={onClose}
    >
      {(endpoints) => <LinkTerminalsForm source={source} endpoints={endpoints} onClose={onClose} />}
    </TerminalContextShareDialogShell>
  )
}

function LinkTerminalsForm({
  source,
  endpoints,
  onClose
}: {
  source: TerminalContextShareSource
  endpoints: TerminalContextShareReadyEndpoints
  onClose: () => void
}): React.JSX.Element {
  const ids = useId()
  const [partnerKey, setPartnerKey] = useState<string | null>(endpoints.targets[0]?.key ?? null)
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
    const toSource = await deliverTextToTerminal(
      endpoints.sourceRuntimeTarget,
      endpoints.sourceHandle,
      buildTerminalLinkNote({ self, partner: partnerRef })
    )
    const toPartner = await deliverTextToTerminal(
      partner.runtimeTarget,
      partner.handle,
      buildTerminalLinkNote({ self: partnerRef, partner: self })
    )
    setSending(false)
    if (toSource.ok && toPartner.ok) {
      toast.success(
        translate(
          'components.terminalContextShare.linked',
          'Linked “{{source}}” with “{{target}}”.',
          {
            source: source.title,
            target: partner.title
          }
        )
      )
      onClose()
      return
    }
    const failure = !toSource.ok ? toSource.message : !toPartner.ok ? toPartner.message : ''
    setError(
      translate(
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
            {translate('components.terminalContextShare.partnerLabel', 'Partner terminal')}
          </Label>
          <TerminalTargetSelect
            id={`${ids}-partner`}
            targets={endpoints.targets}
            value={partnerKey}
            disabled={sending}
            onChange={setPartnerKey}
          />
        </div>
        {partner ? (
          <div className="grid gap-2">
            <Label>
              {translate(
                'components.terminalContextShare.linkPreviewLabel',
                'Note sent to each agent'
              )}
            </Label>
            <pre className="scrollbar-sleek max-h-56 overflow-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {buildTerminalLinkNote({
                self,
                partner: { title: partner.title, handle: partner.handle }
              })}
            </pre>
            <p className="text-xs text-muted-foreground">
              {translate(
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
          {translate('components.terminalContextShare.cancel', 'Cancel')}
        </Button>
        <Button type="button" disabled={sending || !partner} onClick={() => void link()}>
          {sending ? <Loader2 className="size-4 animate-spin" /> : null}
          {translate('components.terminalContextShare.linkSubmit', 'Send Link Notes')}
        </Button>
      </DialogFooter>
    </>
  )
}
