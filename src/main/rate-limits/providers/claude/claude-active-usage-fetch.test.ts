import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setMainHttpClient } from '../../../network/http-client'
import { fetchActiveClaudeRateLimits } from './claude-active-usage-fetch'

vi.mock('../../../network/proxy-settings', () => ({
  ensureElectronProxyFromEnvironment: async () => {}
}))
vi.mock('../../../claude-accounts/runtime-auth/keychain', () => ({
  readActiveClaudeKeychainCredentialsStrict: async () => null
}))

let configDir: string

function credentials(
  accessToken: string | undefined,
  refreshTokenExpiresAt = Number.MAX_SAFE_INTEGER
) {
  writeFileSync(
    join(configDir, '.credentials.json'),
    JSON.stringify({
      claudeAiOauth: {
        accessToken,
        refreshToken: 'test-refresh-token',
        expiresAt: 1,
        refreshTokenExpiresAt
      }
    })
  )
}

function fetchUsage() {
  return fetchActiveClaudeRateLimits({
    authPreparation: {
      configDir,
      envPatch: { CLAUDE_CONFIG_DIR: configDir },
      provenance: 'profile:test-account'
    }
  })
}

function unauthorized(message = 'OAuth access token expired'): Response {
  return Response.json({ error: { message } }, { status: 401 })
}

describe('Claude usage across token expiry', () => {
  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'orca-claude-usage-expiry-'))
  })

  afterEach(() => {
    setMainHttpClient(null)
    rmSync(configDir, { recursive: true, force: true })
  })

  it('uses a token renewed by Claude while the previous usage request was in flight', async () => {
    credentials('expired-access-token')
    setMainHttpClient({
      proxySession: () => null,
      fetch: async (_url, init) => {
        if (new Headers(init?.headers).get('Authorization') === 'Bearer renewed-access-token') {
          return Response.json({ five_hour: { utilization: 37 } })
        }
        credentials('renewed-access-token')
        return unauthorized()
      }
    })

    const result = await fetchUsage()

    expect(result.status).toBe('ok')
    expect(result.session?.usedPercent).toBe(37)
  })

  it('does not report a sign-out while Claude retains a renewable login without an access token', async () => {
    credentials(undefined)

    const result = await fetchUsage()

    expect(result.status).toBe('error')
    expect(result.usageMetadata?.failureKind).toBe('stale-token')

    credentials(undefined, 1)
    expect((await fetchUsage()).usageMetadata?.failureKind).toBe('missing-credentials')
  })
})
