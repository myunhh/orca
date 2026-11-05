import { extname, join, resolve } from 'node:path'
import {
  AGENT_GRAPH_PROVIDERS,
  type AgentGraphProvider
} from '../../../shared/agent-graph/agent-graph-types'
import { isPathInsideOrEqual } from '../../../shared/cross-platform-path'
import { isWslUncPath } from '../../../shared/wsl-paths'
import {
  configuredAdditionalCodexHomePaths,
  getAiVaultWslHomeDirs
} from '../../ai-vault/cached-session-list'
import { claudeProjectsRootDirs } from '../../ai-vault/session-scanner-roots'
import {
  AI_VAULT_AGENT_SOURCES,
  sessionRowRootDirs
} from '../../ai-vault/session-scanner-agent-sources'
import {
  needsWslHostResolution,
  toHostReadableTranscriptPath
} from '../../native-chat/host-readable-transcript-path'
import { admitTranscriptPath } from '../../native-chat/transcript-path-admission'

// Root discovery may probe WSL; graph refreshes poll, so reuse roots briefly.
const ROOTS_TTL_MS = 60_000
let cachedRoots: { at: number; byProvider: Record<AgentGraphProvider, string[]> } | null = null

async function providerRoots(): Promise<Record<AgentGraphProvider, string[]>> {
  if (cachedRoots && Date.now() - cachedRoots.at < ROOTS_TTL_MS) {
    return cachedRoots.byProvider
  }
  // Same root set the subagent listing admits against, plus Orca-managed Codex homes.
  const wslHomeDirs = await getAiVaultWslHomeDirs()
  const codexOptions = {
    additionalCodexSessionsDirs: configuredAdditionalCodexHomePaths().map((home) =>
      join(home, 'sessions')
    )
  }
  const byProvider: Record<AgentGraphProvider, string[]> = {
    claude: claudeProjectsRootDirs({ wslHomeDirs }),
    codex: AI_VAULT_AGENT_SOURCES.codex?.rootDirs(codexOptions, wslHomeDirs) ?? [],
    omp: sessionRowRootDirs('omp', {}, wslHomeDirs)
  }
  cachedRoots = { at: Date.now(), byProvider }
  return byProvider
}

/** Never read a hook- or renderer-supplied path unless it resolves inside that provider's session roots. */
export async function admitAgentGraphTranscript(
  provider: AgentGraphProvider,
  candidate: string
): Promise<string | null> {
  if (!candidate.trim() || extname(candidate).toLowerCase() !== '.jsonl') {
    return null
  }
  const hostPath = await hostReadableCandidate(candidate)
  if (!hostPath) {
    return null
  }
  const roots = (await providerRoots())[provider]
  for (const root of roots) {
    // WSL UNC paths cannot be canonicalized here; fall back to the textual check the vault uses.
    if (isWslUncPath(hostPath) || isWslUncPath(root)) {
      const resolved = resolve(hostPath)
      if (isPathInsideOrEqual(resolve(root), resolved)) {
        return resolved
      }
      continue
    }
    try {
      const admitted = await admitTranscriptPath(root, hostPath)
      if (admitted) {
        return admitted.path
      }
    } catch {
      // An unreadable root cannot admit anything; try the next one.
    }
  }
  return null
}

/** WSL hooks report guest paths; map them to the distro share (refusing stopped distros) like Chat does. */
async function hostReadableCandidate(candidate: string): Promise<string | null> {
  if (!needsWslHostResolution(candidate)) {
    return candidate
  }
  try {
    return await toHostReadableTranscriptPath(candidate)
  } catch {
    return null
  }
}

/** Hook rows may omit the agent kind; the root that contains the transcript names it. */
export async function inferAgentGraphProvider(
  candidate: string
): Promise<{ provider: AgentGraphProvider; transcriptPath: string } | null> {
  for (const provider of AGENT_GRAPH_PROVIDERS) {
    const transcriptPath = await admitAgentGraphTranscript(provider, candidate)
    if (transcriptPath) {
      return { provider, transcriptPath }
    }
  }
  return null
}
