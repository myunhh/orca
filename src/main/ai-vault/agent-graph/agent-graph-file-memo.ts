import type { Stats } from 'node:fs'

const MAX_ENTRIES_PER_MEMO = 256

export function agentGraphFileStamp(stat: Pick<Stats, 'mtimeMs' | 'size'>): string {
  return `${stat.mtimeMs}:${stat.size}`
}

/**
 * The panel rebuilds its graph every few seconds; unchanged transcripts reuse their last read.
 * Lives in the graph service child, so the cache dies with it when the panel goes idle.
 */
export class AgentGraphFileMemo<T> {
  private readonly entries = new Map<string, { stamp: string; value: Promise<T> }>()

  read(path: string, stamp: string, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(path)
    if (hit?.stamp === stamp) {
      // Re-insert so eviction drops the least recently used transcript first.
      this.entries.delete(path)
      this.entries.set(path, hit)
      return hit.value
    }
    const value = load()
    this.entries.delete(path)
    this.entries.set(path, { stamp, value })
    value.catch(() => {
      if (this.entries.get(path)?.value === value) {
        this.entries.delete(path)
      }
    })
    while (this.entries.size > MAX_ENTRIES_PER_MEMO) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) {
        break
      }
      this.entries.delete(oldest)
    }
    return value
  }
}
