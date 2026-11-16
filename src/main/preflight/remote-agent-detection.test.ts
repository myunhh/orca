import { afterEach, expect, it } from 'vitest'
import { z } from 'zod'
import { SshChannelMultiplexer } from '../ssh/protocol/ssh-channel-multiplexer'
import { setSshActiveMultiplexerResolver } from '../ssh/targets/ssh-target-registry'
import { detectRemoteWindowsTerminalCapabilities } from '../ipc/preflight-remote-windows-terminal-capabilities'
import { detectAgentsOnHost } from './workspace-agent-detection'

const multiplexers: SshChannelMultiplexer[] = []
afterEach(() => {
  setSshActiveMultiplexerResolver(null)
  for (const mux of multiplexers.splice(0)) {
    mux.dispose()
  }
})

const commandProbe = z.object({
  commands: z.array(z.object({ id: z.string(), cmd: z.string() }))
})

it('uses a Windows SSH host platform and remote command results rather than the desktop installation', async () => {
  let receiveClient: ((data: Buffer) => void) | undefined
  let receiveHost: ((data: Buffer) => void) | undefined
  const client = new SshChannelMultiplexer({
    write: (data) => queueMicrotask(() => receiveHost?.(data)),
    onData: (callback) => {
      receiveClient = callback
    },
    onClose: () => {}
  })
  const host = new SshChannelMultiplexer({
    write: (data) => queueMicrotask(() => receiveClient?.(data)),
    onData: (callback) => {
      receiveHost = callback
    },
    onClose: () => {}
  })
  multiplexers.push(client, host)
  setSshActiveMultiplexerResolver((id) => (id === 'windows-host' ? client : undefined))
  host.onRequest('preflight.detectWindowsTerminalCapabilities', () => ({
    hostPlatform: 'win32',
    wslAvailable: true,
    wslDistros: ['RemoteUbuntu'],
    pwshAvailable: true,
    gitBashAvailable: false
  }))
  host.onRequest('preflight.detectAgents', (params) => ({
    agents: commandProbe
      .parse(params)
      .commands.filter(({ cmd }) => cmd === 'C:\\Remote Tools\\codex.cmd')
      .map(({ id }) => id)
  }))

  const agents = await detectAgentsOnHost(
    { kind: 'ssh', connectionId: 'windows-host' },
    { agentCmdOverrides: { codex: '"C:\\Remote Tools\\codex.cmd"' } }
  )
  const capabilities = await detectRemoteWindowsTerminalCapabilities({
    connectionId: 'windows-host'
  })

  expect(agents).toEqual(['codex'])
  expect(capabilities.hostPlatform).toBe('win32')
  expect(capabilities.wslDistros).toEqual(['RemoteUbuntu'])
})
