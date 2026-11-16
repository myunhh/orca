import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Loader2, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslate } from '@/i18n/use-translate'
import {
  decodeBrowserScreencastFrame,
  type BrowserScreencastFrameMetadata
} from '../../../../shared/browser/screencast/browser-screencast-protocol'
import { getRemoteBrowserFrameStyle } from '@/components/browser-pane/stream-remote/remote-browser-frame-style'
import {
  decodeRemoteBrowserFrameUrl,
  getRemoteBrowserMouseButton,
  mapRemoteBrowserClientPoint
} from '@/components/browser-pane/stream-remote/remote-browser-page-input-model'
import {
  getRemoteBrowserKeyboardShortcut,
  getRemoteBrowserKeypressKey
} from '@/components/browser-pane/stream-remote/remote-browser-keyboard'
import { iterateBrowserTextInsertionChunks } from '../../../../shared/browser-text-insertion-chunks'
import type {
  WorkbenchBrowserAction,
  WorkbenchBrowserFrame,
  WorkbenchBrowserTabView
} from '../../../../shared/workbench-window/workbench-window-types'
import { sendWorkbenchCommand } from './workbench-window-commands'

type Page = WorkbenchBrowserTabView['pages'][number]

function BrowserPage({ tabId, page }: { tabId: string; page: Page }): React.JSX.Element {
  const t = useTranslate()
  const viewport = useRef<HTMLDivElement>(null)
  const image = useRef<HTMLImageElement>(null)
  const [frame, setFrame] = useState<{
    url: string
    metadata: BrowserScreencastFrameMetadata
    cssViewport: WorkbenchBrowserFrame['cssViewport']
  } | null>(null)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const action = useCallback(
    (action: WorkbenchBrowserAction): void => {
      sendWorkbenchCommand({ kind: 'browserAction', tabId, pageId: page.id, action })
    },
    [page.id, tabId]
  )

  useEffect(() => {
    const api = window.api.workbenchWindows
    const element = viewport.current
    if (!api || !element) {
      return
    }
    let disposed = false
    const layout = (): void => {
      const rect = element.getBoundingClientRect()
      const size =
        rect.width > 0 && rect.height > 0 ? { width: rect.width, height: rect.height } : null
      void api
        .setBrowserViewport(page.id, size)
        .then((accepted) => {
          if (!disposed) {
            setError(!accepted && size !== null)
          }
        })
        .catch(() => {
          if (!disposed) {
            setError(true)
          }
        })
    }
    layout()
    const resize = new ResizeObserver(layout)
    resize.observe(element)
    window.addEventListener('resize', layout)
    return () => {
      disposed = true
      resize.disconnect()
      window.removeEventListener('resize', layout)
      void api.setBrowserViewport(page.id, null)
    }
  }, [page.id, retry])

  useEffect(() => {
    let url: string | null = null
    let generation = 0
    const off = window.api.workbenchWindows?.onBrowserFrame((packet) => {
      if (packet.pageId !== page.id) {
        return
      }
      const decoded = decodeBrowserScreencastFrame(packet.bytes)
      if (!decoded) {
        return
      }
      const next = URL.createObjectURL(
        new Blob([new Uint8Array(decoded.image)], { type: `image/${decoded.format}` })
      )
      const current = ++generation
      void decodeRemoteBrowserFrameUrl(next)
        .then(() => {
          if (current !== generation) {
            URL.revokeObjectURL(next)
            return
          }
          const previous = url
          url = next
          setFrame({ url: next, metadata: decoded.metadata, cssViewport: packet.cssViewport })
          setNotice(null)
          if (previous) {
            URL.revokeObjectURL(previous)
          }
        })
        .catch(() => URL.revokeObjectURL(next))
    })
    const offNotice = window.api.workbenchWindows?.onNotice((notice) => {
      if (notice.browserPageId === page.id) {
        setNotice(notice.message)
      }
    })
    return () => {
      generation += 1
      off?.()
      offNotice?.()
      if (url) {
        URL.revokeObjectURL(url)
      }
    }
  }, [page.id])

  const point = (event: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    const element = image.current
    return element && frame
      ? mapRemoteBrowserClientPoint({
          clientX: event.clientX,
          clientY: event.clientY,
          frameRect: element.getBoundingClientRect(),
          cssViewport: frame.cssViewport
        })
      : null
  }
  const pointer = (
    event: React.PointerEvent<HTMLImageElement>,
    phase: 'move' | 'down' | 'up'
  ): void => {
    if (phase === 'down' && (event.button === 3 || event.button === 4)) {
      event.preventDefault()
      action({ kind: event.button === 3 ? 'back' : 'forward' })
      return
    }
    const position = point(event)
    const button = getRemoteBrowserMouseButton(event.button) ?? (phase === 'move' ? 'left' : null)
    if (!position || !button) {
      return
    }
    event.preventDefault()
    if (phase === 'down') {
      event.currentTarget.focus()
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    action({ kind: 'pointer', phase, ...position, button })
  }
  return (
    <div
      ref={viewport}
      data-workbench-browser-page={page.id}
      className="@container-size relative min-h-0 min-w-0 flex-1 overflow-hidden bg-background"
    >
      {frame ? (
        <img
          ref={image}
          src={frame.url}
          alt=""
          tabIndex={0}
          className="absolute max-w-none outline-none"
          style={getRemoteBrowserFrameStyle(frame.metadata)}
          draggable={false}
          onPointerDown={(event) => pointer(event, 'down')}
          onPointerUp={(event) => pointer(event, 'up')}
          onPointerMove={(event) => pointer(event, 'move')}
          onContextMenu={(event) => event.preventDefault()}
          onWheel={(event) => {
            const position = point(event)
            if (position) {
              action({
                kind: 'wheel',
                ...position,
                deltaX:
                  event.deltaX *
                  (event.deltaMode === 1
                    ? 16
                    : event.deltaMode === 2
                      ? event.currentTarget.clientHeight
                      : 1),
                deltaY:
                  event.deltaY *
                  (event.deltaMode === 1
                    ? 16
                    : event.deltaMode === 2
                      ? event.currentTarget.clientHeight
                      : 1)
              })
            }
          }}
          onKeyDown={(event) => {
            const clipboard =
              (navigator.userAgent.includes('Mac') ? event.metaKey : event.ctrlKey) &&
              event.key.toLowerCase() === 'v'
            if (clipboard) {
              return
            }
            const key =
              getRemoteBrowserKeyboardShortcut(event) ?? getRemoteBrowserKeypressKey(event)
            if (!key) {
              return
            }
            event.preventDefault()
            action(
              event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey
                ? { kind: 'text', text: event.key }
                : { kind: 'key', key }
            )
          }}
          onPaste={(event) => {
            event.preventDefault()
            for (const text of iterateBrowserTextInsertionChunks(
              event.clipboardData.getData('text/plain')
            )) {
              action({ kind: 'text', text })
            }
          }}
        />
      ) : null}
      {error ? (
        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-background p-4 text-xs text-muted-foreground">
          {t('workbench.browser.connecting', 'Waiting for the browser page…')}
          <Button variant="ghost" size="xs" onClick={() => setRetry((value) => value + 1)}>
            {t('common.retry', 'Retry')}
          </Button>
        </div>
      ) : !frame ? (
        <div className="flex h-full items-center justify-center">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : null}
      {notice || !frame ? (
        <div
          role="status"
          className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-2 rounded-md border border-border bg-popover p-2 text-xs text-popover-foreground"
        >
          <span>
            {notice ?? t('workbench.browser.connecting', 'Waiting for the browser page…')}
          </span>
          <Button variant="secondary" size="xs" onClick={() => action({ kind: 'reconnect' })}>
            {t('browser.reconnect', 'Reconnect')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export function WorkbenchBrowserBody({
  tabId,
  browser
}: {
  tabId: string
  browser: WorkbenchBrowserTabView
}): React.JSX.Element {
  const t = useTranslate()
  const page = browser.pages.find((page) => page.id === browser.activePageId) ?? browser.pages[0]
  const [address, setAddress] = useState(page?.url ?? '')
  useEffect(() => setAddress(page?.url ?? ''), [page?.id, page?.url])
  const action = (action: WorkbenchBrowserAction): void => {
    if (page) {
      sendWorkbenchCommand({ kind: 'browserAction', tabId, pageId: page.id, action })
    }
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {browser.pages.length > 1 ? (
        <div role="tablist" className="flex h-8 shrink-0 overflow-x-auto border-b border-border">
          {browser.pages.map((entry) => (
            <Button
              key={entry.id}
              role="tab"
              aria-selected={entry.id === page?.id}
              variant={entry.id === page?.id ? 'secondary' : 'ghost'}
              size="xs"
              className="max-w-48 shrink-0 truncate"
              onClick={() =>
                sendWorkbenchCommand({ kind: 'selectBrowserPage', tabId, pageId: entry.id })
              }
            >
              {entry.title || entry.url}
            </Button>
          ))}
        </div>
      ) : null}
      <form
        className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2"
        onSubmit={(event) => {
          event.preventDefault()
          action({ kind: 'navigate', url: address })
        }}
      >
        {(
          [
            ['back', ArrowLeft, t('browser.back', 'Back'), !page],
            ['forward', ArrowRight, t('browser.forward', 'Forward'), !page],
            ['reload', RotateCw, t('browser.reload', 'Reload'), !page]
          ] as const
        ).map(([kind, Icon, label, disabled]) => (
          <Tooltip key={kind}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={label}
                disabled={disabled}
                onClick={() => action({ kind })}
              >
                <Icon />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>
              {label}
            </TooltipContent>
          </Tooltip>
        ))}
        <Input
          aria-label={t('browser.address', 'Address')}
          className="h-7 min-w-0 flex-1 text-xs"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
        />
      </form>
      {page ? <BrowserPage key={page.id} tabId={tabId} page={page} /> : null}
    </div>
  )
}
