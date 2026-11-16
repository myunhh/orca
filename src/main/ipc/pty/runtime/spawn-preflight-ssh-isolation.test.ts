import { afterEach, expect, it } from 'vitest'
import { SshChannelMultiplexer } from '../../../ssh/protocol/ssh-channel-multiplexer'
import { SshPtyProvider } from '../../../providers/ssh-pty-provider'
import { registerSshPtyProvider, unregisterSshPtyProvider } from '../provider/registry'
import { JCODE_RUNTIME_DIR_ENV_KEY } from '../../../../shared/jcode-runtime-dir'
import { resolvePtySpawnStartupTarget } from '../spawn-startup-target'
import { createRuntimePtySpawnState } from './spawn-state'
import { prepareRuntimePtySpawn } from './spawn-preflight'
import { makeRuntimePtySpawnTestDeps } from './spawn-preflight-test-deps-fixture'

const live: { provider: SshPtyProvider; mux: SshChannelMultiplexer }[] = []
afterEach(() => {
  unregisterSshPtyProvider('remote-host')
  for (const { provider, mux } of live.splice(0)) {
    provider.dispose()
    mux.dispose()
  }
})

it('keeps an SSH Claude launch out of local daemon, credential and runtime-directory preparation', async () => {
  const mux = new SshChannelMultiplexer({
    write: () => {
      throw new Error('Spawn preparation must not dispatch relay commands')
    },
    onData: () => {},
    onClose: () => {}
  })
  const provider = new SshPtyProvider('remote-host', mux)
  live.push({ provider, mux })
  registerSshPtyProvider('remote-host', provider)
  const deps = makeRuntimePtySpawnTestDeps()
  deps.prepareClaudeAuth = async () => {
    throw new Error('Local Claude credentials must not be read for SSH')
  }
  deps.prepareCodexResumeHome = () => {
    throw new Error('Local resume homes must not be read for SSH')
  }
  deps.getSelectedCodexHomePath = () => {
    throw new Error('Local Codex credentials must not be read for SSH')
  }
  const ctx = createRuntimePtySpawnState(deps, {
    cols: 80,
    rows: 24,
    connectionId: 'remote-host',
    worktreeId: 'repo::/remote/project',
    cwd: '/remote/project/subdir',
    command: 'claude',
    launchAgent: 'claude',
    tabId: 'tab1',
    leafId: '11111111-1111-4111-8111-111111111111',
    env: { USER_VALUE: 'intentional-remote-value' }
  })

  await prepareRuntimePtySpawn(ctx)

  expect(ctx.provider).toBe(provider)
  expect(ctx.isDaemonHostSpawn).toBe(false)
  expect(ctx.sessionId).toBeUndefined()
  expect(ctx.cwd).toBe('/remote/project/subdir')
  expect(ctx.launchCommand).toBe('claude')
  expect(ctx.claudeAuth).toBeNull()
  expect(ctx.selectedCodexHomePath).toBeNull()
  expect(ctx.env?.USER_VALUE).toBe('intentional-remote-value')
  expect(ctx.env?.CLAUDE_CONFIG_DIR).toBeUndefined()
  expect(ctx.env?.CODEX_HOME).toBeUndefined()
  expect(ctx.env?.[JCODE_RUNTIME_DIR_ENV_KEY]).toBeUndefined()
})

it('leaves remote cwd and shell selection to the remote owner instead of probing local Windows or WSL', async () => {
  const result = await resolvePtySpawnStartupTarget({
    connectionId: 'remote-host',
    worktreeId: 'repo::/remote/project',
    cwd: '/remote/project/subdir',
    sessionId: undefined,
    shellOverride: '/remote/bin/fish',
    plannedPty: { shellOverride: 'wsl.exe', terminalWindowsWslDistro: 'LocalUbuntu' },
    projectRuntimeSource: { kind: 'sent', projectRuntime: undefined },
    preAdopted: false,
    getSettings: () => {
      throw new Error('Local shell preferences must not be read for SSH')
    },
    resolveStartupCwd: (_worktreeId, cwd) => cwd
  })

  expect(result.cwd).toBe('/remote/project/subdir')
  expect(result.requestedCwd).toBe('/remote/project/subdir')
  expect(result.terminalRuntimeOptions).toEqual({
    shellOverride: '/remote/bin/fish',
    terminalWindowsWslDistro: null
  })
  expect(result.expectedWslDistro).toBeNull()
})
