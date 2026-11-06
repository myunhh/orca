import { app } from 'electron'

// Substituted at build time by electron.vite.config.ts; undefined in tests and other tooling.
declare const ORCA_FORK_DISABLES_SELF_UPDATE: boolean

function forkDisablesSelfUpdate(): boolean {
  try {
    return ORCA_FORK_DISABLES_SELF_UPDATE === true
  } catch {
    // ReferenceError: the constant was never substituted, so this is not a fork release build.
    return false
  }
}

/**
 * This fork is built by hand; installing an upstream release over it would drop its added
 * features, so packaged builds do not self-update unless ORCA_ALLOW_UPSTREAM_UPDATES=1.
 */
export function isSelfUpdateEnabled(): boolean {
  if (!app.isPackaged) {
    return false
  }
  return !forkDisablesSelfUpdate() || process.env.ORCA_ALLOW_UPSTREAM_UPDATES === '1'
}
