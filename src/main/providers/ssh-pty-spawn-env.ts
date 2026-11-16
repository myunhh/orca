import { seedPowerlevel10kWizardEnv } from '../pty/shell-startup/powerlevel10k-wizard-env'
import type { RemoteCliBridgeEnv } from './ssh-pty-provider-contract'
import {
  AGENT_HOOK_RUNTIME_ENV_KEYS,
  AGENT_PANE_HOOK_ENV_KEYS
} from '../ipc/pty/host-env/spawn-env-keys'
import { isRemoteAgentHooksEnabled } from '../ssh/ssh-relay-hook-controls'

const CLIENT_HOST_ENV_KEYS = [
  ...AGENT_HOOK_RUNTIME_ENV_KEYS,
  'ORCA_CLI_COMMAND',
  'ORCA_CLI_BIN_DIR',
  'ORCA_CLI_INSTALL_PATH',
  'ORCA_CLI_CWD',
  'ORCA_DEV_REPO_ROOT',
  'ORCA_DEV_USER_DATA_PATH',
  'ORCA_USER_DATA',
  'ORCA_USER_DATA_PATH',
  'ELECTRON_RUN_AS_NODE'
] as const

export function buildSshPtySpawnEnv(args: {
  env: Record<string, string> | undefined
  envToDelete?: readonly string[]
  remoteCliBridgeEnv?: RemoteCliBridgeEnv
}): Record<string, string> {
  const merged = { ...args.env }
  for (const key of CLIENT_HOST_ENV_KEYS) {
    delete merged[key]
  }
  if (!isRemoteAgentHooksEnabled()) {
    for (const key of AGENT_PANE_HOOK_ENV_KEYS) {
      delete merged[key]
    }
  }
  if (args.remoteCliBridgeEnv) {
    const pathDelimiter = args.remoteCliBridgeEnv.pathDelimiter ?? ':'
    const pathKey = merged.PATH !== undefined ? 'PATH' : merged.Path !== undefined ? 'Path' : null
    if (pathKey) {
      const pathValue = merged[pathKey] ?? ''
      merged[pathKey] = pathValue.split(pathDelimiter).includes(args.remoteCliBridgeEnv.binDir)
        ? pathValue
        : pathValue
          ? `${args.remoteCliBridgeEnv.binDir}${pathDelimiter}${pathValue}`
          : args.remoteCliBridgeEnv.binDir
    }
    merged.ORCA_REMOTE_CLI_BIN_DIR = args.remoteCliBridgeEnv.binDir
    merged.ORCA_RELAY_DIR = args.remoteCliBridgeEnv.relayDir
    merged.ORCA_RELAY_NODE_PATH = args.remoteCliBridgeEnv.nodePath
    merged.ORCA_RELAY_SOCKET_PATH = args.remoteCliBridgeEnv.sockPath
    if (args.remoteCliBridgeEnv.credentialFile) {
      merged.ORCA_RELAY_CREDENTIAL_FILE = args.remoteCliBridgeEnv.credentialFile
    }
  }
  // Why: match local/daemon precedence—managed defaults cannot restore explicitly removed values.
  for (const key of args.envToDelete ?? []) {
    delete merged[key]
  }
  seedPowerlevel10kWizardEnv(merged, { envToDelete: args.envToDelete })
  return merged
}
