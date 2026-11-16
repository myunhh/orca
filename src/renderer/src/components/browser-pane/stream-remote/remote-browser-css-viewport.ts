import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { readRemoteCssViewportSize } from './remote-browser-page-input-model'
import type { RemoteBrowserRuntimeTarget } from './remote-browser-page-input-model'
import type { RemoteBrowserViewportSize } from './remote-browser-stream-tokens'

/** Read page CSS coordinates, not the compositor bitmap size used to paint a stream. */
export async function readRemoteBrowserCssViewport(
  target: RemoteBrowserRuntimeTarget,
  worktree: string,
  pageId: string
): Promise<RemoteBrowserViewportSize | null> {
  try {
    const viewport = await callRuntimeRpc(
      target,
      'browser.eval',
      {
        worktree,
        page: pageId,
        expression: 'JSON.stringify({ width: window.innerWidth, height: window.innerHeight })'
      },
      { timeoutMs: 15_000, suppressFeatureInteraction: true }
    )
    return readRemoteCssViewportSize(viewport)
  } catch {
    // Unknown: pointer mapping falls back to requested and per-frame sizes.
    return null
  }
}
