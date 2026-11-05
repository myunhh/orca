import { Link2, Share2 } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { CmdJQuickAction } from './quick-actions'
import type { CmdJQuickActionAvailability } from './quick-action-context'
import {
  openTerminalContextShareDialog,
  type TerminalContextShareKind
} from '@/components/terminal-context-share/terminal-context-share-request'
import { activeTerminalContextShareSource } from '@/components/terminal-context-share/terminal-context-share-source'

function availability(): CmdJQuickActionAvailability {
  return activeTerminalContextShareSource()
    ? { available: true }
    : { available: false, reason: 'no-active-terminal' }
}

function shareAction(
  kind: TerminalContextShareKind,
  action: Pick<CmdJQuickAction, 'id' | 'title' | 'description' | 'icon' | 'verbKeywords'>
): CmdJQuickAction {
  return {
    ...action,
    kind: 'action',
    isAvailable: availability,
    run: async () => {
      const source = activeTerminalContextShareSource()
      if (!source) {
        return { status: 'unavailable', reason: 'no-active-terminal' }
      }
      openTerminalContextShareDialog(kind, source)
      return { status: 'ok' }
    }
  }
}

export function getTerminalContextShareQuickActions(): CmdJQuickAction[] {
  return [
    shareAction('share', {
      id: 'share-terminal-context',
      title: translate('components.cmdJ.terminalContextShare.shareTitle', 'Share Terminal Context'),
      description: translate(
        'components.cmdJ.terminalContextShare.shareDescription',
        'Summarize the active terminal and send it to another agent.'
      ),
      icon: Share2,
      verbKeywords: [
        translate('components.cmdJ.terminalContextShare.verbs.shareContext', 'share context'),
        translate('components.cmdJ.terminalContextShare.verbs.handOff', 'hand off context'),
        translate('components.cmdJ.terminalContextShare.verbs.summarize', 'summarize terminal')
      ]
    }),
    shareAction('link', {
      id: 'link-terminals',
      title: translate('components.cmdJ.terminalContextShare.linkTitle', 'Link Terminals'),
      description: translate(
        'components.cmdJ.terminalContextShare.linkDescription',
        'Let the active agent and another agent read and control each other’s terminal.'
      ),
      icon: Link2,
      verbKeywords: [
        translate('components.cmdJ.terminalContextShare.verbs.linkTerminals', 'link terminals'),
        translate('components.cmdJ.terminalContextShare.verbs.pairAgents', 'pair agents')
      ]
    })
  ]
}
