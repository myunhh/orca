export const AGENT_HOOK_INSTALL_MANAGED_HOOKS_METHOD = 'agent_hook.installManagedHooks' as const

export function isRemoteAgentHooksEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.ORCA_FEATURE_REMOTE_AGENT_HOOKS
  return raw === undefined || !['0', 'false', 'off', 'no'].includes(raw.trim().toLowerCase())
}
