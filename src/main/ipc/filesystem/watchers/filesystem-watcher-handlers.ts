import { ipcMain } from 'electron'
import { watcherLifecycleState } from './filesystem-watcher-lifecycle-state'
import {
  subscribeLocalWatcher,
  unsubscribeLocalWatcher
} from './filesystem-watcher-local-subscription'
import {
  subscribeSshFilesystemWatcher,
  unsubscribeSshFilesystemWatcher
} from './filesystem-watcher-ssh'

export function registerFilesystemWatcherHandlers(): void {
  ipcMain.handle(
    'fs:watchWorktree',
    async (event, args: { worktreePath: string; connectionId?: string }): Promise<void> => {
      if (args.connectionId != null) {
        await subscribeSshFilesystemWatcher(args.connectionId, args.worktreePath, event.sender)
        return
      }
      // Reopen for post-shutdown attachment; older callers retain the retired generation.
      watcherLifecycleState.localWatchersClosed = false
      await subscribeLocalWatcher(args.worktreePath, event.sender)
    }
  )

  ipcMain.handle(
    'fs:unwatchWorktree',
    (event, args: { worktreePath: string; connectionId?: string }): void => {
      if (args.connectionId != null) {
        unsubscribeSshFilesystemWatcher(args.connectionId, args.worktreePath, event.sender.id)
        return
      }
      unsubscribeLocalWatcher(args.worktreePath, event.sender.id)
    }
  )
}
