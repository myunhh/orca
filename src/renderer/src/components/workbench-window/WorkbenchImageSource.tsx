import { useEffect, useMemo } from 'react'
import { LocalImageSourceContext } from '@/components/editor/document-images/useLocalImageSrc'
import { createNonSecureContextUuid } from '../../../../shared/non-secure-context-uuid'

export function WorkbenchImageSource({
  tabId,
  children
}: {
  tabId: string
  children: React.ReactNode
}): React.JSX.Element {
  const source = useMemo(() => {
    const urls = new Set<string>()
    const pending = new Set<() => void>()
    const loads = new Map<string, Promise<string | null>>()
    const load = (rawSrc: string): Promise<string | null> => {
      const cached = loads.get(rawSrc)
      if (cached) {
        return cached
      }
      const api = window.api.workbenchWindows
      if (!api) {
        return Promise.resolve(null)
      }
      const requestId = createNonSecureContextUuid()
      const { promise, resolve } = Promise.withResolvers<string | null>()
      const finish = (url: string | null): void => {
        clearTimeout(timer)
        off()
        pending.delete(cancel)
        resolve(url)
      }
      const cancel = (): void => finish(null)
      const off = api.onEditorContent((answer) => {
        if (answer.requestId !== requestId || answer.tabId !== tabId) {
          return
        }
        if (answer.status !== 'ok' || !answer.mimeType?.startsWith('image/')) {
          finish(null)
          return
        }
        try {
          const bytes = answer.isBinary
            ? Uint8Array.from(atob(answer.content), (character) => character.charCodeAt(0))
            : answer.content
          const url = URL.createObjectURL(new Blob([bytes], { type: answer.mimeType }))
          urls.add(url)
          finish(url)
        } catch {
          finish(null)
        }
      })
      const timer = setTimeout(cancel, 30_000)
      pending.add(cancel)
      void api.sendCommand({ kind: 'readEditorImage', tabId, requestId, rawSrc }).catch(cancel)
      loads.set(rawSrc, promise)
      return promise
    }
    return { key: createNonSecureContextUuid(), load, urls, pending, loads }
  }, [tabId])
  useEffect(
    () => () => {
      for (const cancel of source.pending) {
        cancel()
      }
      for (const url of source.urls) {
        URL.revokeObjectURL(url)
      }
      source.urls.clear()
      source.loads.clear()
    },
    [source]
  )
  return <LocalImageSourceContext value={source}>{children}</LocalImageSourceContext>
}
