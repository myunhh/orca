import { useEffect, useMemo } from 'react'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'
import { useAppStore } from '../../store'
import type { InactiveAccountUsage, ProviderRateLimits } from '../../../../shared/rate-limit-types'
import { createPendingProviderSnapshot } from './status-bar-provider-visibility'
import { getClaudeStatusActiveId } from './status-bar-claude-accounts'
import { getCodexStatusActiveId } from './status-bar-codex-accounts'

// Main debounces inactive fetches to 60s; this keeps the extra chips fresh without the menu open.
const EXTRA_ACCOUNT_REFRESH_MS = 5 * 60_000

export type StatusBarExtraAccount = {
  accountId: string
  email: string
  label: string
  rateLimits: ProviderRateLimits
}

type AccountIdentity = { id: string; email: string }

export type StatusBarProviderAccounts = {
  /** The active account's identity; null for System default, whose email is not in Settings. */
  active: { email: string; label: string } | null
  others: StatusBarExtraAccount[]
}

export type StatusBarExtraAccounts = Partial<
  Record<ProviderRateLimits['provider'], StatusBarProviderAccounts>
>

function accountLabel(email: string): string {
  return email.split('@')[0] || email
}

function buildProviderAccounts(
  provider: 'claude' | 'codex',
  inactive: readonly InactiveAccountUsage[],
  accounts: readonly AccountIdentity[] | undefined,
  activeId: string | null | undefined
): StatusBarProviderAccounts | undefined {
  const extras: StatusBarExtraAccount[] = []
  for (const account of accounts ?? []) {
    if (account.id === activeId) {
      continue
    }
    const usage =
      inactive.find((entry) => entry.accountId === account.id)?.rateLimits ??
      createPendingProviderSnapshot(provider)
    extras.push({
      accountId: account.id,
      email: account.email,
      label: accountLabel(account.email),
      rateLimits: usage
    })
  }
  if (extras.length === 0) {
    return undefined
  }
  const active = accounts?.find((account) => account.id === activeId)
  return {
    active: active ? { email: active.email, label: accountLabel(active.email) } : null,
    others: extras
  }
}

/** Signed-in Claude/Codex accounts other than the active one, so every account's usage shows. */
export function useStatusBarExtraAccounts(): StatusBarExtraAccounts {
  const showClaude = useAppStore((s) => s.statusBarVisible && s.statusBarItems.includes('claude'))
  const showCodex = useAppStore((s) => s.statusBarVisible && s.statusBarItems.includes('codex'))
  const inactiveClaude = useAppStore((s) => s.rateLimits.inactiveClaudeAccounts)
  const inactiveCodex = useAppStore((s) => s.rateLimits.inactiveCodexAccounts)
  const claudeAccounts = useAppStore((s) => s.settings?.claudeManagedAccounts)
  const codexAccounts = useAppStore((s) => s.settings?.codexManagedAccounts)
  const activeClaudeId = useAppStore((s) =>
    getClaudeStatusActiveId(
      {
        activeAccountId: s.settings?.activeClaudeManagedAccountId ?? null,
        activeAccountIdsByRuntime: s.settings?.activeClaudeManagedAccountIdsByRuntime
      },
      s.rateLimits.claudeTarget
    )
  )
  const activeCodexId = useAppStore((s) =>
    getCodexStatusActiveId(
      {
        activeAccountId: s.settings?.activeCodexManagedAccountId ?? null,
        activeAccountIdsByRuntime: s.settings?.activeCodexManagedAccountIdsByRuntime
      },
      s.rateLimits.codexTarget
    )
  )
  const fetchInactiveClaude = useAppStore((s) => s.fetchInactiveClaudeAccountUsage)
  const fetchInactiveCodex = useAppStore((s) => s.fetchInactiveCodexAccountUsage)
  const wantClaude = showClaude && (claudeAccounts?.length ?? 0) > 0
  const wantCodex = showCodex && (codexAccounts?.length ?? 0) > 0

  useEffect(() => {
    if (!wantClaude && !wantCodex) {
      return
    }
    const fetchAll = (): void => {
      if (wantClaude) {
        void fetchInactiveClaude()
      }
      if (wantCodex) {
        void fetchInactiveCodex()
      }
    }
    return installWindowVisibilityInterval({
      run: fetchAll,
      intervalMs: EXTRA_ACCOUNT_REFRESH_MS
    })
  }, [
    wantClaude,
    wantCodex,
    fetchInactiveClaude,
    fetchInactiveCodex,
    claudeAccounts,
    codexAccounts,
    activeClaudeId,
    activeCodexId
  ])

  return useMemo(
    () => ({
      claude: wantClaude
        ? buildProviderAccounts('claude', inactiveClaude, claudeAccounts, activeClaudeId)
        : undefined,
      codex: wantCodex
        ? buildProviderAccounts('codex', inactiveCodex, codexAccounts, activeCodexId)
        : undefined
    }),
    [
      wantClaude,
      wantCodex,
      inactiveClaude,
      inactiveCodex,
      claudeAccounts,
      codexAccounts,
      activeClaudeId,
      activeCodexId
    ]
  )
}
