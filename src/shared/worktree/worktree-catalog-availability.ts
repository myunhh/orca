/** An unreadable catalog is not authoritative emptiness; conflating them tears down live state (docs/reference/ssh-execution-boundary.md, #14004). */
export class WorktreeCatalogUnavailableError extends Error {
  /** Structural marker: survives JSON-RPC re-wrapping better than `instanceof` across module copies. */
  readonly worktreeCatalogUnavailable = true

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'WorktreeCatalogUnavailableError'
  }
}

export function assertAuthoritativeWorktreeCatalog<T>(worktrees: unknown, repoPath: string): T[] {
  if (!Array.isArray(worktrees) || worktrees.length === 0) {
    throw new WorktreeCatalogUnavailableError(
      `Worktree catalog unavailable for ${repoPath}: the execution host returned no worktree listing. ` +
        'Treating this as an empty catalog would authorize removing workspaces that still exist.'
    )
  }
  return worktrees as T[]
}
