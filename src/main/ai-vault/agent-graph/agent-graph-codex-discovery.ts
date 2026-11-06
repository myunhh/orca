import { basename, dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { childDayDirectory } from '../../../shared/codex-subagent-transcript'
import {
  openTranscriptReadStream,
  wslGatedReaddir,
  wslGatedStat
} from '../../native-chat/wsl-transcript-fs-access'
import {
  readCodexNonUserOrigin,
  type CodexNonUserOrigin
} from '../scanners/codex/session-scanner-codex-non-user-origin'
import { asRecord } from '../session-scanner-record-value'
import { extractString, parseJsonObject } from '../session-scanner-values'
import { AgentGraphFileMemo, agentGraphFileStamp } from './agent-graph-file-memo'

// Rollouts in the parent's day folders; a busy day holds far more, but only newer ones can be children.
const MAX_CANDIDATES_PER_DIRECTORY = 400
const HEAD_READ_CONCURRENCY = 8
// session_meta is the first record; allow a few lines for leading noise.
const MAX_HEAD_LINES = 4
const ROLLOUT_NAME = /^rollout-.*\.jsonl$/
const UUID_TAIL = /-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

type CodexRolloutHead = { threadId: string | null; origin: CodexNonUserOrigin | null }

const heads = new AgentGraphFileMemo<CodexRolloutHead | null>()

/** Rollout filenames end in the thread id, which covers payloads that omit `id`. */
export function codexThreadIdFromRolloutPath(path: string): string | null {
  const stem = basename(path).replace(/\.jsonl$/i, '')
  return UUID_TAIL.exec(stem)?.[1] ?? null
}

async function readCodexRolloutHead(path: string): Promise<CodexRolloutHead | null> {
  let stamp: string
  try {
    stamp = agentGraphFileStamp(await wslGatedStat(path, 'scan'))
  } catch {
    return null
  }
  return heads.read(path, stamp, () => scanRolloutHead(path))
}

async function scanRolloutHead(path: string): Promise<CodexRolloutHead | null> {
  const input = openTranscriptReadStream(path, { encoding: 'utf-8' }, 'scan')
  const lines = createInterface({ input, crlfDelay: Infinity })
  try {
    let seen = 0
    for await (const line of lines) {
      const record = parseJsonObject(line)
      seen += 1
      if (record?.type === 'session_meta') {
        const payload = asRecord(record.payload)
        return payload
          ? { threadId: extractString(payload.id), origin: readCodexNonUserOrigin(payload) }
          : null
      }
      if (seen >= MAX_HEAD_LINES) {
        break
      }
    }
  } catch {
    // An unreadable candidate is simply not a child.
  } finally {
    lines.close()
    input.destroy()
  }
  return null
}

/**
 * Children name their parent in their own first session_meta, so they are found even when the
 * parent rollout never recorded a spawn event for them. Only rollouts written after the parent
 * started can be its children, which keeps the scan to the parent's day folders.
 */
export async function discoverCodexChildrenByParent(args: {
  parentPath: string
  parentThreadId: string
  directoryCache: Map<string, string[]>
  checkCancelled: () => void
}): Promise<{ threadId: string; path: string }[]> {
  const parentName = basename(args.parentPath)
  const parentDir = dirname(args.parentPath)
  const todayDir = childDayDirectory(args.parentPath, Date.now())
  const directories = todayDir && todayDir !== parentDir ? [parentDir, todayDir] : [parentDir]
  const found: { threadId: string; path: string }[] = []
  for (const directory of directories) {
    const names = await listRolloutNames(directory, args.directoryCache)
    const newer = names
      .filter((name) => directory !== parentDir || name > parentName)
      .slice(-MAX_CANDIDATES_PER_DIRECTORY)
    for (let index = 0; index < newer.length; index += HEAD_READ_CONCURRENCY) {
      args.checkCancelled()
      const batch = newer.slice(index, index + HEAD_READ_CONCURRENCY)
      const results = await Promise.all(
        batch.map(async (name) => {
          const path = join(directory, name)
          const head = await readCodexRolloutHead(path)
          const parentage = head?.origin?.parentage
          const threadId = head?.threadId ?? codexThreadIdFromRolloutPath(path)
          return parentage?.parentThreadId === args.parentThreadId && threadId
            ? { threadId, path }
            : null
        })
      )
      for (const result of results) {
        if (result) {
          found.push(result)
        }
      }
    }
  }
  return found
}

async function listRolloutNames(
  directory: string,
  directoryCache: Map<string, string[]>
): Promise<string[]> {
  let names = directoryCache.get(directory)
  if (!names) {
    try {
      names = (await wslGatedReaddir(directory, 'scan')).map((entry) => entry.name)
    } catch {
      names = []
    }
    directoryCache.set(directory, names)
  }
  return names.filter((name) => ROLLOUT_NAME.test(name)).sort()
}
