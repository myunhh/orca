import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import { sendPromptWithGuardedPasteAndEnter } from '@/lib/agent-session/messaging/terminal/active-agent-note-send-delivery'
import { activeAgentNotesSendFailureMessage } from '@/lib/agent-session/messaging/terminal/active-agent-note-send-result'

export type TerminalContextDeliveryResult = { ok: true } | { ok: false; message: string }

/** Guarded paste then submit, addressed by handle so it works from any window and runtime. */
export async function deliverTextToTerminal(
  runtimeTarget: RuntimeClientTarget,
  handle: string,
  text: string
): Promise<TerminalContextDeliveryResult> {
  try {
    const result = await sendPromptWithGuardedPasteAndEnter(runtimeTarget, handle, text.trim(), {
      allowLegacyFallback: false
    })
    return result.status === 'sent'
      ? { ok: true }
      : {
          ok: false,
          message: activeAgentNotesSendFailureMessage(result.status, {
            explicitTarget: true,
            code: result.code
          })
        }
  } catch {
    return {
      ok: false,
      message: activeAgentNotesSendFailureMessage('status-unavailable', {
        explicitTarget: true,
        code: 'runtime-unverifiable'
      })
    }
  }
}
