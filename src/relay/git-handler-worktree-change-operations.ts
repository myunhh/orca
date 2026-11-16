import { GitHandlerOperationContext, GIT_BULK_CHUNK_SIZE } from './git-handler-operation-context'
import { commitChangesRelay } from './git-handler-worktree-ops'

const BULK_CHUNK_SIZE = GIT_BULK_CHUNK_SIZE

export class GitHandlerWorktreeChangeOperations extends GitHandlerOperationContext {
  async stage(params: Record<string, unknown>) {
    this.clearGitMutationReadCaches()
    const worktreePath = params.worktreePath as string
    const filePath = params.filePath as string
    try {
      await this.git(['add', '--', this.literalPathspec(filePath)], worktreePath)
    } finally {
      this.clearGitMutationReadCaches()
    }
  }

  async commit(params: Record<string, unknown>): Promise<{ success: boolean; error?: string }> {
    this.clearGitMutationReadCaches()
    const worktreePath = params.worktreePath as string
    const message = params.message as string
    try {
      return await commitChangesRelay(this.git.bind(this), worktreePath, message)
    } finally {
      this.clearGitMutationReadCaches()
    }
  }

  async unstage(params: Record<string, unknown>) {
    this.clearGitMutationReadCaches()
    const worktreePath = params.worktreePath as string
    const filePath = params.filePath as string
    try {
      await this.git(['restore', '--staged', '--', this.literalPathspec(filePath)], worktreePath)
    } finally {
      this.clearGitMutationReadCaches()
    }
  }

  async bulkUnstage(params: Record<string, unknown>) {
    this.clearGitMutationReadCaches()
    const worktreePath = params.worktreePath as string
    const filePaths = params.filePaths as string[]
    try {
      for (let i = 0; i < filePaths.length; i += BULK_CHUNK_SIZE) {
        const chunk = filePaths.slice(i, i + BULK_CHUNK_SIZE)
        await this.git(
          ['restore', '--staged', '--', ...chunk.map((filePath) => this.literalPathspec(filePath))],
          worktreePath
        )
      }
    } finally {
      this.clearGitMutationReadCaches()
    }
  }

  async abortMerge(params: Record<string, unknown>) {
    this.clearGitMutationReadCaches()
    const worktreePath = params.worktreePath as string
    try {
      await this.git(['merge', '--abort'], worktreePath)
    } finally {
      this.clearGitMutationReadCaches()
    }
  }

  async abortRebase(params: Record<string, unknown>) {
    this.clearGitMutationReadCaches()
    const worktreePath = params.worktreePath as string
    try {
      await this.git(['rebase', '--abort'], worktreePath)
    } finally {
      this.clearGitMutationReadCaches()
    }
  }
}
