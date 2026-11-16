import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { browserManager } from '../browser/guest-lifecycle/manager/browser-manager'
import { waitForTabRegistration } from './browser/browser-tab-registration-wait'
import { getTrustedUIRendererWindow } from './ui'
import { getWorkbenchWindow } from '../window/workbench-windows'
import { decodeBrowserScreencastFrame } from '../../shared/browser/screencast/browser-screencast-protocol'
import type { WorkbenchBrowserViewport } from '../../shared/workbench-window/workbench-window-types'
import { isWorkbenchBrowserViewport } from './workbench-browser-payload-validation'

type Stream = {
  windowId: string
  pageId: string
  sizeKey: string
  controller: AbortController
  done: Promise<void>
}

/** Subscribe to the existing runtime's shared stream; the original guest and registration never move. */
export class WorkbenchBrowserStreams {
  private readonly streams = new Map<string, Stream>()

  constructor(
    private readonly runtime: Pick<OrcaRuntimeService, 'browserScreencast'>,
    private readonly isAssigned: (windowId: string, pageId: string) => boolean
  ) {}

  setViewport(
    windowId: string,
    pageId: string,
    viewport: WorkbenchBrowserViewport | null,
    restart = false
  ): void {
    const key = `${windowId}:${pageId}`
    const previous = this.streams.get(key)
    if (!viewport) {
      previous?.controller.abort()
      this.streams.delete(key)
      return
    }
    const sizeKey = `${viewport.width}:${viewport.height}`
    if (!restart && previous?.sizeKey === sizeKey) {
      return
    }
    previous?.controller.abort()
    const stream: Stream = {
      windowId,
      pageId,
      sizeKey,
      controller: new AbortController(),
      done: Promise.resolve()
    }
    this.streams.set(key, stream)
    const current = (): boolean =>
      this.streams.get(key) === stream &&
      !stream.controller.signal.aborted &&
      this.isAssigned(windowId, pageId)
    const report = (message: string): void => {
      if (current()) {
        getWorkbenchWindow(windowId)?.webContents.send('workbench:notice', {
          kind: 'error',
          browserPageId: pageId,
          message
        })
      }
    }
    stream.done = (async () => {
      await previous?.done
      if (!current()) {
        return
      }
      const initialOwner = getTrustedUIRendererWindow()
      if (
        !initialOwner ||
        !browserManager.getAuthorizedGuest(pageId, initialOwner.webContents.id)
      ) {
        await waitForTabRegistration(pageId)
      }
      if (!current()) {
        return
      }
      const owner = getTrustedUIRendererWindow()
      const guest = owner ? browserManager.getAuthorizedGuest(pageId, owner.webContents.id) : null
      if (!guest) {
        throw new Error('This browser page is no longer available.')
      }
      let cssViewport: WorkbenchBrowserViewport | null = null
      let refreshing = false
      let deviceSize: string | null = null
      const refreshViewport = (): void => {
        if (refreshing || !current() || guest.isDestroyed()) {
          return
        }
        refreshing = true
        cssViewport = null
        void guest
          .executeJavaScript('({ width: window.innerWidth, height: window.innerHeight })')
          .then((size: unknown) => {
            if (!current()) {
              return
            }
            if (size !== null && isWorkbenchBrowserViewport(size)) {
              cssViewport = size
            } else {
              report('The browser viewport is not available.')
            }
          })
          .catch((error: unknown) => report(error instanceof Error ? error.message : String(error)))
          .finally(() => {
            refreshing = false
          })
      }
      guest.on('did-finish-load', refreshViewport)
      try {
        await this.runtime.browserScreencast(
          {
            page: pageId,
            format: 'jpeg',
            quality: 70,
            maxWidth: 3840,
            maxHeight: 2160,
            everyNthFrame: 2,
            minFrameIntervalMs: 33,
            viewportWidth: viewport.width,
            viewportHeight: viewport.height,
            deviceScaleFactor: 1
          },
          {
            connectionId: `workbench:${windowId}:${pageId}`,
            clientKind: 'runtime',
            signal: stream.controller.signal,
            sendBinary: (bytes) => {
              if (!current()) {
                return false
              }
              const frame = decodeBrowserScreencastFrame(bytes)
              if (!frame) {
                return false
              }
              const nextDeviceSize = `${frame.metadata.deviceWidth}:${frame.metadata.deviceHeight}`
              if (deviceSize !== nextDeviceSize) {
                deviceSize = nextDeviceSize
                refreshViewport()
              }
              const destination = getWorkbenchWindow(windowId)
              if (!cssViewport || !destination) {
                return false
              }
              destination.webContents.send('workbench:browserFrame', { pageId, bytes, cssViewport })
              return true
            },
            emit: (event) => {
              if (event.type === 'ready') {
                refreshViewport()
              } else if (event.type === 'error') {
                report(event.message)
              } else if (event.type === 'end') {
                report('The browser stream ended. Reconnect to continue.')
              }
            }
          }
        )
      } finally {
        if (!guest.isDestroyed()) {
          guest.off('did-finish-load', refreshViewport)
        }
      }
    })()
      .catch((error: unknown) => {
        report(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (this.streams.get(key) === stream) {
          this.streams.delete(key)
        }
      })
  }

  reconcile(): void {
    for (const stream of this.streams.values()) {
      if (!this.isAssigned(stream.windowId, stream.pageId)) {
        this.setViewport(stream.windowId, stream.pageId, null)
      }
    }
  }

  closeWindow(windowId: string): void {
    for (const stream of this.streams.values()) {
      if (stream.windowId === windowId) {
        this.setViewport(windowId, stream.pageId, null)
      }
    }
  }

  closeAll(): void {
    for (const stream of this.streams.values()) {
      stream.controller.abort()
    }
    this.streams.clear()
  }
}
