import { useMemo } from 'react'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useTranslate } from '@/i18n/use-translate'
import type { TerminalContextShareSource } from './terminal-context-share-request'
import {
  useTerminalContextShareEndpoints,
  type TerminalContextShareEndpoints
} from './use-terminal-context-share-endpoints'

type ReadyEndpoints = Extract<TerminalContextShareEndpoints, { status: 'ready' }>

/** Both dialogs submit text into an agent terminal, so they share the security surface. Closing cancels a running summary. */
export function TerminalContextShareDialogShell({
  source,
  title,
  description,
  sameRuntimeOnly = false,
  onClose,
  children
}: {
  source: TerminalContextShareSource
  title: string
  description: string
  /** Keep only targets whose handles resolve on the source's runtime. */
  sameRuntimeOnly?: boolean
  onClose: () => void
  children: (endpoints: ReadyEndpoints) => React.ReactNode
}): React.JSX.Element {
  const t = useTranslate()
  const loaded = useTerminalContextShareEndpoints(source)
  const endpoints = useMemo(
    () =>
      sameRuntimeOnly && loaded.status === 'ready'
        ? { ...loaded, targets: loaded.targets.filter((target) => target.onSourceRuntime) }
        : loaded,
    [loaded, sameRuntimeOnly]
  )
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent surface="security" className="sm:max-w-xl" scrollable>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {endpoints.status === 'loading' ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t('components.terminalContextShare.loadingTerminals', 'Finding terminals…')}
          </p>
        ) : endpoints.status === 'error' ? (
          <p role="alert" className="text-sm text-destructive">
            {endpoints.reason === 'source-unavailable'
              ? t(
                  'components.terminalContextShare.sourceUnavailable',
                  'This terminal is not available to Orca right now.'
                )
              : t(
                  'components.terminalContextShare.targetsUnavailable',
                  'Could not list terminals. Try again in a moment.'
                )}
          </p>
        ) : endpoints.targets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t(
              'components.terminalContextShare.noTargets',
              'Open another terminal to share with first.'
            )}
          </p>
        ) : (
          children(endpoints)
        )}
      </DialogContent>
    </Dialog>
  )
}

export type { ReadyEndpoints as TerminalContextShareReadyEndpoints }
