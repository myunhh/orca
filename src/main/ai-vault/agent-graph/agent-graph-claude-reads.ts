import type { AiVaultSession } from '../../../shared/ai-vault/contracts/ai-vault-types'
import { wslGatedStat } from '../../native-chat/wsl-transcript-fs-access'
import {
  collectClaudeSubagentParentLinks,
  type ClaudeSubagentParentLinks
} from '../scanners/claude/claude-subagent-parent-links'
import type { ClaudeTranscriptParser } from '../scanners/claude/session-scanner-claude-subagents'
import { parseClaudeSessionFile } from '../scanners/claude/session-scanner-primary-parsers'
import { AgentGraphFileMemo, agentGraphFileStamp } from './agent-graph-file-memo'

const sessions = new AgentGraphFileMemo<AiVaultSession | null>()
const parentLinks = new AgentGraphFileMemo<ClaudeSubagentParentLinks>()

/** Same parse the subagent listing does, reused while the transcript's mtime is unchanged. */
export const parseClaudeTranscriptCached: ClaudeTranscriptParser = (file, platform) =>
  sessions.read(file.path, String(file.mtimeMs), () => parseClaudeSessionFile(file, platform))

export async function parseClaudeTranscript(path: string): Promise<AiVaultSession | null> {
  try {
    const fileStat = await wslGatedStat(path, 'scan')
    return await parseClaudeTranscriptCached(
      { path, mtimeMs: fileStat.mtimeMs, modifiedAt: fileStat.mtime.toISOString() },
      process.platform
    )
  } catch {
    return null
  }
}

export async function readClaudeParentLinks(path: string): Promise<ClaudeSubagentParentLinks> {
  const load = (): Promise<ClaudeSubagentParentLinks> =>
    collectClaudeSubagentParentLinks(path, { detailed: true })
  let stamp: string
  try {
    stamp = agentGraphFileStamp(await wslGatedStat(path, 'scan'))
  } catch {
    // The collector degrades an unreadable parent to empty links; do not cache that.
    return load()
  }
  return parentLinks.read(path, stamp, load)
}
