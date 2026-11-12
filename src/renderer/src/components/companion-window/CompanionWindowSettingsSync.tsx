import { useEffect } from 'react'
import { applyDocumentTheme } from '@/app-shell/appearance/document-theme'
import { resolvePaintedTheme } from '@/app-shell/appearance/terminal-app-theme'
import { useAppStore } from '@/store'
import { useReduceVisualEffects } from '@/hooks/use-reduce-visual-effects'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { applyCompanionWindowAppearance } from './companion-window-appearance'

/** Keep a companion window's separate store in step with app settings and keybindings. */
export function CompanionWindowSettingsSync(): null {
  const settings = useAppStore((state) => state.settings)
  useReduceVisualEffects(settings?.reduceVisualEffects)

  useEffect(() => {
    let disposed = false
    // Preview-terminal copy/paste overrides live in a separate keybinding file.
    void useAppStore.getState().fetchKeybindings()
    const setSettings = (next: GlobalSettings): void => {
      if (!disposed) {
        useAppStore.setState({ settings: next })
      }
    }
    const offChanged = window.api.settings.onChanged((updates) => {
      const current = useAppStore.getState().settings
      if (current) {
        setSettings({ ...current, ...updates })
      }
    })
    void window.api.settings
      .get()
      .then(setSettings)
      .catch(() => undefined)
    return () => {
      disposed = true
      offChanged()
    }
  }, [])

  useEffect(() => {
    applyCompanionWindowAppearance(settings)
    if (settings?.theme !== 'system') {
      return
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = (): void => applyDocumentTheme(resolvePaintedTheme(settings))
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [settings])

  return null
}
