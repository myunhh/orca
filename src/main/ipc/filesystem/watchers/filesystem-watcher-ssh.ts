import type { WebContents } from 'electron'
import type { FsChangedPayload } from '../../../../shared/file-watch/filesystem-change-event'
import type { IFilesystemProvider } from '../../../providers/filesystem-provider-contract'
import {
  getSshFilesystemProvider,
  onSshFilesystemProviderRegistered,
  requireSshFilesystemProvider
} from '../../../providers/ssh-filesystem-dispatch'
import { abortWhenRendererGone } from '../../renderer-lifetime-abort'

type Subscription = {
  connectionId: string
  root: string
  sender: WebContents
  lifetime: ReturnType<typeof abortWhenRendererGone>
  provider?: IFilesystemProvider
  controller?: AbortController
  unsubscribe?: () => void
}
const subscriptions = new Map<string, Subscription>()
let unregisterProviderListener: (() => void) | undefined

function key(connectionId: string, root: string, senderId: number): string {
  return JSON.stringify([connectionId, root, senderId])
}
function send(subscription: Subscription, payload: FsChangedPayload): void {
  if (!subscription.sender.isDestroyed() && !subscription.lifetime.signal.aborted) {
    subscription.sender.send('fs:changed', payload)
  }
}
function resync(subscription: Subscription): void {
  send(subscription, {
    worktreePath: subscription.root,
    connectionId: subscription.connectionId,
    events: [{ kind: 'overflow', absolutePath: subscription.root }],
    resync: true
  })
}
function stopWatch(subscription: Subscription): void {
  subscription.controller?.abort()
  subscription.unsubscribe?.()
  subscription.controller = undefined
  subscription.unsubscribe = undefined
  subscription.provider = undefined
}
function remove(subscription: Subscription): void {
  subscriptions.delete(key(subscription.connectionId, subscription.root, subscription.sender.id))
  stopWatch(subscription)
  subscription.lifetime.dispose()
}
async function install(subscription: Subscription, provider: IFilesystemProvider): Promise<void> {
  stopWatch(subscription)
  const controller = new AbortController()
  subscription.controller = controller
  subscription.provider = provider
  try {
    const unsubscribe = await provider.watch(
      subscription.root,
      (events) => {
        if (
          subscription.controller !== controller ||
          getSshFilesystemProvider(subscription.connectionId) !== provider
        ) {
          return
        }
        send(subscription, {
          worktreePath: subscription.root,
          connectionId: subscription.connectionId,
          events
        })
      },
      {
        signal: controller.signal,
        onTerminalError: () => {
          if (subscription.controller === controller) {
            stopWatch(subscription)
            resync(subscription)
          }
        }
      }
    )
    if (subscription.controller !== controller || controller.signal.aborted) {
      unsubscribe()
      return
    }
    subscription.unsubscribe = unsubscribe
    resync(subscription)
  } catch (error) {
    const wasAborted = controller.signal.aborted
    if (subscription.controller === controller) {
      stopWatch(subscription)
      resync(subscription)
    }
    if (!wasAborted) {
      throw error
    }
  }
}
export async function subscribeSshFilesystemWatcher(
  connectionId: string,
  root: string,
  sender: WebContents
): Promise<void> {
  const provider = requireSshFilesystemProvider(connectionId)
  const id = key(connectionId, root, sender.id)
  const existing = subscriptions.get(id)
  if (existing?.provider === provider && existing.unsubscribe) {
    return
  }
  if (!unregisterProviderListener) {
    unregisterProviderListener = onSshFilesystemProviderRegistered((targetId) => {
      const current = getSshFilesystemProvider(targetId)
      if (!current) {
        return
      }
      for (const subscription of subscriptions.values()) {
        if (subscription.connectionId === targetId) {
          void install(subscription, current).catch((error) =>
            console.warn('[fs:watch] SSH rearm failed:', error)
          )
        }
      }
    })
  }
  const subscription = existing ?? {
    connectionId,
    root,
    sender,
    lifetime: abortWhenRendererGone(sender)
  }
  if (!existing) {
    subscriptions.set(id, subscription)
    subscription.lifetime.signal.addEventListener('abort', () => remove(subscription), {
      once: true
    })
  }
  await install(subscription, provider)
}
export function unsubscribeSshFilesystemWatcher(
  connectionId: string,
  root: string,
  senderId: number
): void {
  const subscription = subscriptions.get(key(connectionId, root, senderId))
  if (subscription) {
    remove(subscription)
  }
}
export function closeSshFilesystemWatchers(): void {
  for (const subscription of subscriptions.values()) {
    remove(subscription)
  }
  unregisterProviderListener?.()
  unregisterProviderListener = undefined
}
