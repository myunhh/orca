import {
  TerminalUnavailableCauseSchema,
  type TerminalUnavailableCause
} from '../../shared/terminal/runtime-policy/terminal-unavailable-cause'

export function terminalUnavailableCauseFromError(error: unknown): TerminalUnavailableCause | null {
  if (typeof error !== 'object' || error === null || !('data' in error)) {
    return null
  }
  const parsed = TerminalUnavailableCauseSchema.safeParse(error.data)
  return parsed.success ? parsed.data : null
}

export function mayRepairFromCause(cause: TerminalUnavailableCause | null): boolean {
  return cause !== null && cause.status === 'blocked' && cause.repairable
}
