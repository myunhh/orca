// @vitest-environment happy-dom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmptyRateLimitState } from '../../../../shared/rate-limit-state-factory'
import type { InactiveAccountUsage } from '../../../../shared/rate-limit-types'
import { useStatusBarExtraAccounts } from './use-status-bar-extra-accounts'
import { isSignedOutInactiveUsage } from './InlineProviderUsage'

const mocks = vi.hoisted(() => {
  const state: { current: unknown } = { current: null }
  return state
})
vi.mock('../../store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) => selector(mocks.current)
}))
vi.mock('@/lib/window-activity/window-visibility-interval', () => ({
  installWindowVisibilityInterval: () => () => {}
}))

function state() {
  const accounts = [
    { id: 'host-active', email: 'host@example.com' },
    { id: 'wsl-active', email: 'wsl@example.com' },
    { id: 'expired', email: 'expired@example.com' },
    { id: 'pending', email: 'pending@example.com' }
  ]
  const expired: InactiveAccountUsage[] = ['claude', 'codex'].map((provider) => ({
    accountId: 'expired',
    updatedAt: 1,
    isFetching: false,
    rateLimits: {
      provider: provider === 'claude' ? 'claude' : 'codex',
      session: null,
      weekly: null,
      updatedAt: 1,
      error: 'Expired token',
      status: 'error',
      usageMetadata: { failureKind: provider === 'claude' ? 'stale-token' : 'missing-credentials' }
    }
  }))
  return {
    statusBarVisible: true,
    statusBarItems: ['claude', 'codex'],
    activeWorkspaceId: 'ssh-workspace',
    settings: {
      claudeManagedAccounts: accounts,
      codexManagedAccounts: accounts,
      activeClaudeManagedAccountIdsByRuntime: {
        host: 'host-active',
        wsl: { Ubuntu: 'wsl-active' }
      },
      activeCodexManagedAccountIdsByRuntime: { host: 'host-active', wsl: { Ubuntu: 'wsl-active' } }
    },
    rateLimits: createEmptyRateLimitState({
      inactiveClaudeAccounts: expired.filter((entry) => entry.rateLimits?.provider === 'claude'),
      inactiveCodexAccounts: expired.filter((entry) => entry.rateLimits?.provider === 'codex')
    }),
    fetchInactiveClaudeAccountUsage: async () => {},
    fetchInactiveCodexAccountUsage: async () => {}
  }
}

afterEach(cleanup)

describe('local account usage chips', () => {
  it('retains saved Claude and Codex accounts without usage windows in an SSH workspace', () => {
    mocks.current = state()

    const { result } = renderHook(() => useStatusBarExtraAccounts())

    expect(result.current.claude?.others.map((account) => account.accountId)).toEqual([
      'wsl-active',
      'expired',
      'pending'
    ])
    expect(result.current.codex?.others.map((account) => account.accountId)).toEqual([
      'wsl-active',
      'expired',
      'pending'
    ])
    expect(result.current.claude?.others[1].rateLimits.usageMetadata?.failureKind).toBe(
      'stale-token'
    )
    expect(result.current.codex?.others[1].rateLimits.usageMetadata?.failureKind).toBe(
      'missing-credentials'
    )
    expect(result.current.claude?.others[2].rateLimits.status).toBe('fetching')
  })

  it('labels the runtime actually polled instead of always treating the host account as active', () => {
    const current = state()
    current.rateLimits.claudeTarget = { runtime: 'wsl', wslDistro: 'Ubuntu' }
    current.rateLimits.codexTarget = { runtime: 'wsl', wslDistro: 'Ubuntu' }
    mocks.current = current

    const { result } = renderHook(() => useStatusBarExtraAccounts())

    expect(result.current.claude?.active?.email).toBe('wsl@example.com')
    expect(result.current.codex?.active?.email).toBe('wsl@example.com')
    expect(result.current.claude?.others.map((account) => account.accountId)).toContain(
      'host-active'
    )
    expect(result.current.codex?.others.map((account) => account.accountId)).not.toContain(
      'wsl-active'
    )
  })

  it('does not offer Codex sign-in for a usage outage but does for a rejected login', () => {
    expect(
      isSignedOutInactiveUsage({
        provider: 'codex',
        session: null,
        weekly: null,
        updatedAt: 1,
        error: 'Your access token could not be refreshed: error sending request',
        status: 'error',
        usageMetadata: { failureKind: 'network' }
      })
    ).toBe(false)
    expect(
      isSignedOutInactiveUsage({
        provider: 'codex',
        session: null,
        weekly: null,
        updatedAt: 1,
        error: 'Your refresh token has expired. Please sign in again.',
        status: 'error',
        usageMetadata: { failureKind: 'missing-credentials' }
      })
    ).toBe(true)
  })
})
