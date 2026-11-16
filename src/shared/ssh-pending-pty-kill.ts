import type { SshRemotePtyLease } from './ssh-types'

/** An unconfirmed client-local stop, replayed only against the same relay PTY incarnation. */
export type SshPendingPtyKill = {
  requestedAt: number
  /** Fence the intended incarnation: legacy pty-N IDs recycle after relay restart (#16970).
   * Current relays enforce it; preflight listProcesses also protects older relays that ignore the field.
   * Only epoch-scoped pty2: IDs may omit it because they cannot recur across starts. */
  incarnationId?: string
  /** Replays attempted since. Diagnostic; the TTL, not this, is the bound. */
  attempts: number
}

/** pty2:<epoch>:<n> has a fresh epoch per start; legacy pty-N IDs recycle. */
export function isEpochScopedRelayPtyId(relayPtyId: string): boolean {
  return relayPtyId.startsWith('pty2:')
}

/** The strict lease loader strips unknown fields; colocate admission so persistence cannot silently lose pending kills. */
export function normalizeSshPendingPtyKill(
  value: unknown,
  relayPtyId: string
): SshPendingPtyKill | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const raw = value as Partial<SshPendingPtyKill>
  if (typeof raw.requestedAt !== 'number' || !Number.isFinite(raw.requestedAt)) {
    return null
  }
  const attempts = typeof raw.attempts === 'number' && raw.attempts >= 0 ? raw.attempts : 0
  if (raw.incarnationId === undefined && isEpochScopedRelayPtyId(relayPtyId)) {
    return { requestedAt: raw.requestedAt, attempts }
  }
  // Never retain an unfenced kill for a recyclable ID.
  if (
    typeof raw.incarnationId !== 'string' ||
    !raw.incarnationId ||
    raw.incarnationId.length > 128
  ) {
    return null
  }
  return { requestedAt: raw.requestedAt, incarnationId: raw.incarnationId, attempts }
}

export const SSH_PENDING_PTY_KILL_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const MAX_SSH_PENDING_PTY_KILLS_PER_TARGET = 200

export function isSshPendingPtyKillExpired(intent: SshPendingPtyKill, now: number): boolean {
  return now - intent.requestedAt > SSH_PENDING_PTY_KILL_TTL_MS
}

/** Only a successful host inventory supplies an observation; transport failure means defer. */
export type SshPendingPtyKillObservation = {
  hostListsPty: boolean
  hostIncarnationId: string | undefined
}

export type SshPendingPtyKillRetirement =
  | 'host-reports-absent'
  | 'relay-id-recycled'
  | 'stop-confirmed'

export type SshPendingPtyKillDecision =
  | { action: 'replay' }
  | { action: 'retire'; reason: Exclude<SshPendingPtyKillRetirement, 'stop-confirmed'> }
  | { action: 'defer'; reason: string }

export function decideSshPendingPtyKill(
  intent: SshPendingPtyKill,
  observation: SshPendingPtyKillObservation,
  now: number
): SshPendingPtyKillDecision {
  if (isSshPendingPtyKillExpired(intent, now)) {
    return { action: 'defer', reason: 'order is past its TTL and awaiting prune' }
  }
  if (!observation.hostListsPty) {
    return { action: 'retire', reason: 'host-reports-absent' }
  }
  if (intent.incarnationId === undefined) {
    // Admission permits an omitted incarnation only for an epoch-scoped, non-recyclable ID.
    return { action: 'replay' }
  }
  if (observation.hostIncarnationId === undefined) {
    return { action: 'defer', reason: 'host published no PTY incarnation for this id' }
  }
  if (observation.hostIncarnationId !== intent.incarnationId) {
    return { action: 'retire', reason: 'relay-id-recycled' }
  }
  return { action: 'replay' }
}

export type SshPendingPtyKillEntry = { ptyId: string; intent: SshPendingPtyKill }

export function prunePendingSshPtyKills(
  entries: readonly SshPendingPtyKillEntry[],
  now: number
): SshPendingPtyKillEntry[] {
  return entries
    .filter((entry) => !isSshPendingPtyKillExpired(entry.intent, now))
    .sort((a, b) => b.intent.requestedAt - a.intent.requestedAt)
    .slice(0, MAX_SSH_PENDING_PTY_KILLS_PER_TARGET)
}

/** A closed tab's routing tombstone can still carry an unconfirmed remote stop. */
export function pendingSshPtyKillEntries(
  leases: readonly SshRemotePtyLease[]
): SshPendingPtyKillEntry[] {
  const entries: SshPendingPtyKillEntry[] = []
  for (const lease of leases) {
    if (lease.pendingKill) {
      entries.push({ ptyId: lease.ptyId, intent: lease.pendingKill })
    }
  }
  return entries
}
