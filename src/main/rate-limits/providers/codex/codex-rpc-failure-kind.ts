import type { UsageRateLimitFailureKind } from '../../../../shared/rate-limit-types'
import { isCodexAuthError } from '../../../../shared/codex-auth-errors'

// reqwest wraps proxy/DNS/TCP/TLS failures in these phrases; HTTP-status failures use different text.
const CODEX_TRANSPORT_FAILURE_PATTERN =
  /\berror sending request\b|\brequest or response body error\b/i

export function classifyCodexRpcErrorFailureKind(
  message: string
): UsageRateLimitFailureKind | undefined {
  if (CODEX_TRANSPORT_FAILURE_PATTERN.test(message)) {
    return 'network'
  }
  return isCodexAuthError(message) ? 'missing-credentials' : undefined
}
