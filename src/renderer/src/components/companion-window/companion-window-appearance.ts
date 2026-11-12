import { applyDocumentTheme } from '@/app-shell/appearance/document-theme'
import { resolvePaintedTheme } from '@/app-shell/appearance/terminal-app-theme'
import { buildAppFontFamily } from '@/app-shell/appearance/app-font-family'
import { applyCodeFontSmoothing } from '@/lib/editor/appearance/code-font-smoothing'
import { useAppStore } from '@/store'
import type { GlobalSettings } from '../../../../shared/global-settings-types'

export function applyCompanionWindowAppearance(settings: GlobalSettings | null): void {
  applyDocumentTheme(resolvePaintedTheme(settings), { disableTransitions: false })
  document.documentElement.style.setProperty(
    '--app-font-family',
    buildAppFontFamily(settings?.appFontFamily)
  )
  applyCodeFontSmoothing(settings?.codeFontSmoothing)
}

/** Seed a companion window's separate store synchronously to prevent OS-theme flash before async hydration. */
export function seedCompanionWindowSettings(): void {
  let startupSettings: GlobalSettings | null = null
  try {
    startupSettings = window.api.settings.getSync()
  } catch {
    // Async hydration in CompanionWindowSettingsSync remains available if the startup read fails.
  }
  if (startupSettings) {
    useAppStore.setState({ settings: startupSettings })
  }
  applyCompanionWindowAppearance(startupSettings)
}
