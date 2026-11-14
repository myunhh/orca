import { useId, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import {
  DEFAULT_TERMINAL_CONTEXT_SUMMARY_MODEL_CHOICE_ID,
  TERMINAL_CONTEXT_INSTRUCTION_MAX_CHARS,
  TERMINAL_CONTEXT_SUMMARY_MODEL_CHOICES
} from '../../../../shared/terminal-context-share/terminal-context-share-types'
import type {
  TerminalContextSharePreferredTarget,
  TerminalContextShareSource
} from './terminal-context-share-request'
import type { TerminalContextReadMode } from './terminal-context-source-read'
import {
  TerminalContextShareDialogShell,
  type TerminalContextShareReadyEndpoints
} from './TerminalContextShareDialogShell'
import { firstSelectableTargetKey, TerminalTargetSelect } from './TerminalTargetSelect'
import { buildSourceReadHint } from './terminal-context-share-messages'
import {
  useShareTerminalContext,
  type ShareTerminalContextStage
} from './use-share-terminal-context'

function stageLabel(stage: ShareTerminalContextStage, t: Translate): string | null {
  switch (stage) {
    case 'reading':
      return t('components.terminalContextShare.stageReading', 'Reading terminal…')
    case 'summarizing':
      return t('components.terminalContextShare.stageSummarizing', 'Summarizing…')
    case 'sending':
      return t('components.terminalContextShare.stageSending', 'Sending…')
    case 'idle':
      return null
  }
}

export default function ShareTerminalContextDialog({
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
      title={t('components.terminalContextShare.shareTitle', 'Share Terminal Context')}
      description={t(
        'components.terminalContextShare.shareDescription',
        'Send what “{{source}}” is working on to another terminal’s agent. Review the text before it is sent.',
        { source: source.title }
      )}
      onClose={onClose}
    >
      {(endpoints) => (
        <ShareTerminalContextForm
          source={source}
          preferredTarget={preferredTarget}
          endpoints={endpoints}
          onClose={onClose}
        />
      )}
    </TerminalContextShareDialogShell>
  )
}

function ShareTerminalContextForm({
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
  const [targetKey, setTargetKey] = useState<string | null>(() =>
    firstSelectableTargetKey(endpoints.targets, preferredTarget)
  )
  const [mode, setMode] = useState<TerminalContextReadMode>(
    window.api.terminalContext ? 'summary' : 'raw'
  )
  const [choiceId, setChoiceId] = useState(DEFAULT_TERMINAL_CONTEXT_SUMMARY_MODEL_CHOICE_ID)
  const [instruction, setInstruction] = useState('')
  const share = useShareTerminalContext({
    sourceTitle: source.title,
    sourceHandle: endpoints.sourceHandle,
    sourceRuntimeTarget: endpoints.sourceRuntimeTarget,
    sourceAgent: endpoints.sourceAgentLabel
  })
  const target = endpoints.targets.find((candidate) => candidate.key === targetKey) ?? null
  const choice =
    TERMINAL_CONTEXT_SUMMARY_MODEL_CHOICES.find((candidate) => candidate.id === choiceId) ??
    TERMINAL_CONTEXT_SUMMARY_MODEL_CHOICES[0]
  const working = share.stage !== 'idle'
  const progress = stageLabel(share.stage, t)

  const send = async (): Promise<void> => {
    if (!target) {
      return
    }
    const result = await share.send(target)
    if (result.ok) {
      toast.success(
        t('components.terminalContextShare.sent', 'Context sent to “{{target}}”.', {
          target: target.title
        })
      )
      onClose()
    }
  }

  return (
    <>
      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor={`${ids}-target`}>
            {t('components.terminalContextShare.targetLabel', 'Send to')}
          </Label>
          <TerminalTargetSelect
            id={`${ids}-target`}
            terminals={endpoints.targets}
            value={targetKey}
            disabled={working}
            onChange={setTargetKey}
          />
        </div>
        <div className="grid gap-2">
          <Label>{t('components.terminalContextShare.contentLabel', 'Content')}</Label>
          <ToggleGroup
            type="single"
            spacing={1}
            size="sm"
            variant="segmented-card"
            value={mode}
            disabled={working}
            onValueChange={(next) => {
              if (next === 'summary' || next === 'raw') {
                setMode(next)
              }
            }}
          >
            <ToggleGroupItem value="summary" disabled={!window.api.terminalContext}>
              {t('components.terminalContextShare.modeSummary', 'Summarize with model')}
            </ToggleGroupItem>
            <ToggleGroupItem value="raw">
              {t('components.terminalContextShare.modeRaw', 'Send raw screen')}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        {mode === 'summary' ? (
          <>
            <div className="grid gap-2">
              <Label htmlFor={`${ids}-model`}>
                {t('components.terminalContextShare.modelLabel', 'Summary model')}
              </Label>
              <Select value={choice.id} onValueChange={setChoiceId} disabled={working}>
                <SelectTrigger id={`${ids}-model`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  {TERMINAL_CONTEXT_SUMMARY_MODEL_CHOICES.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t(
                  'components.terminalContextShare.modelHint',
                  'Runs headlessly with your local Claude or Codex CLI login.'
                )}
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${ids}-instruction`}>
                {t('components.terminalContextShare.instructionLabel', 'Focus (optional)')}
              </Label>
              <Textarea
                id={`${ids}-instruction`}
                rows={2}
                value={instruction}
                maxLength={TERMINAL_CONTEXT_INSTRUCTION_MAX_CHARS}
                disabled={working}
                placeholder={t(
                  'components.terminalContextShare.instructionPlaceholder',
                  'e.g. the failing test and what was already tried'
                )}
                onChange={(event) => setInstruction(event.target.value)}
              />
            </div>
          </>
        ) : null}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={working}
            onClick={() => void share.generate({ mode, choice, instruction })}
          >
            {share.preview === null
              ? t('components.terminalContextShare.generate', 'Generate Preview')
              : t('components.terminalContextShare.regenerate', 'Regenerate')}
          </Button>
          {progress ? (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {progress}
            </span>
          ) : null}
          {share.stage === 'reading' || share.stage === 'summarizing' ? (
            <Button type="button" variant="ghost" size="sm" onClick={share.cancel}>
              {t('components.terminalContextShare.stop', 'Stop')}
            </Button>
          ) : null}
        </div>
        {share.preview !== null ? (
          <div className="grid gap-2">
            <Label htmlFor={`${ids}-preview`}>
              {t('components.terminalContextShare.previewLabel', 'Message to send')}
            </Label>
            <Textarea
              id={`${ids}-preview`}
              variant="code"
              rows={10}
              className="max-h-80"
              value={share.preview}
              disabled={working}
              onChange={(event) => share.setPreview(event.target.value)}
            />
            {target?.onSourceRuntime ? (
              <p className="text-xs text-muted-foreground">
                {t(
                  'components.terminalContextShare.readHintNote',
                  'Orca appends this line for the receiving agent: {{line}}',
                  { line: buildSourceReadHint(endpoints.sourceHandle) }
                )}
              </p>
            ) : null}
          </div>
        ) : null}
        {share.error ? (
          <p role="alert" className="text-xs text-destructive">
            {share.error}
          </p>
        ) : null}
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('components.terminalContextShare.cancel', 'Cancel')}
        </Button>
        <Button
          type="button"
          disabled={working || !target || !share.preview?.trim()}
          onClick={() => void send()}
        >
          {t('components.terminalContextShare.send', 'Send to Agent')}
        </Button>
      </DialogFooter>
    </>
  )
}
