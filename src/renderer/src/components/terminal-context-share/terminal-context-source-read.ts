import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { RuntimeTerminalRead } from '../../../../shared/runtime-terminal-contracts'
import { TERMINAL_CONTEXT_READ_LINE_LIMIT } from '../../../../shared/terminal-context-share/terminal-context-share-types'
import { normalizeTerminalContextLines } from '../../../../shared/terminal-context-share/terminal-context-summary-prompt'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'

export type TerminalContextReadMode = 'summary' | 'raw'

const READ_TIMEOUT_MS = 10_000
/** Raw snapshots are pasted verbatim into the target agent; keep them small. */
const RAW_SNAPSHOT_MAX_CHARS = 20_000
const RAW_STREAM_FALLBACK_LINES = 200

async function readTerminal(
  runtimeTarget: RuntimeClientTarget,
  params: { terminal: string; limit?: number; screen?: true },
  signal?: AbortSignal
): Promise<RuntimeTerminalRead> {
  const { terminal } = await callRuntimeRpc<{ terminal: RuntimeTerminalRead }>(
    runtimeTarget,
    'terminal.read',
    params,
    { timeoutMs: READ_TIMEOUT_MS, signal }
  )
  return terminal
}

/**
 * Agent TUIs redraw in place, so their scrollback is noise; the rendered screen is the reliable view.
 * Summaries get the stream tail plus the current screen, raw shares get the screen alone.
 */
export async function readTerminalContextText(args: {
  runtimeTarget: RuntimeClientTarget
  handle: string
  mode: TerminalContextReadMode
  signal?: AbortSignal
}): Promise<string> {
  const { runtimeTarget, handle, mode, signal } = args
  const screen = await readTerminal(
    runtimeTarget,
    { terminal: handle, screen: true },
    signal
  ).catch(() => null)
  const screenLines = screen?.source === 'screen' ? screen.tail : null
  if (mode === 'raw') {
    const lines =
      screenLines ??
      (
        await readTerminal(
          runtimeTarget,
          { terminal: handle, limit: RAW_STREAM_FALLBACK_LINES },
          signal
        )
      ).tail
    return normalizeTerminalContextLines(lines, RAW_SNAPSHOT_MAX_CHARS)
  }
  const stream = await readTerminal(
    runtimeTarget,
    { terminal: handle, limit: TERMINAL_CONTEXT_READ_LINE_LIMIT },
    signal
  )
  const lines = screenLines
    ? [...stream.tail, '', '----- current screen -----', ...screenLines]
    : stream.tail
  return normalizeTerminalContextLines(lines)
}
