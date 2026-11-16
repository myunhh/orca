import { getActiveMultiplexer } from '../../../ssh/targets/ssh-target-registry'
import { isJsonRpcMethodNotFoundError } from '../../../providers/ssh-git-relay-errors'

export async function registerSshWorktreeCreateRoots(
  connectionId: string,
  rootPaths: string[]
): Promise<void> {
  const mux = getActiveMultiplexer(connectionId)
  if (!mux) {
    throw new Error('SSH connection is not available. Please reconnect and try again.')
  }
  try {
    await Promise.all(
      rootPaths.map((rootPath) => mux.request('session.registerRoot', { rootPath }))
    )
  } catch (error) {
    if (!isJsonRpcMethodNotFoundError(error)) {
      throw error
    }
    // Older relays register authorized roots through a notification instead of a request.
    for (const rootPath of rootPaths) {
      mux.notify('session.registerRoot', { rootPath })
    }
  }
}
