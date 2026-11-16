import { z } from 'zod'
import { getActiveMultiplexer } from '../ssh/targets/ssh-target-registry'
import { SshHostNotServedError } from '../providers/ssh-host-not-served-error'
import { detectRemoteWindowsTerminalCapabilities } from '../ipc/preflight-remote-windows-terminal-capabilities'
import {
  detectAgentsUsingCommandProbe,
  type InstalledAgentDetectionOptions
} from './installed-agent-detection'

const remoteCommandDetection = z.object({ agents: z.array(z.string()) })

export async function detectRemoteAgents(
  connectionId: string,
  options?: InstalledAgentDetectionOptions
): Promise<string[]> {
  const runtime = (await detectRemoteWindowsTerminalCapabilities({ connectionId })).hostPlatform
  if (!runtime) {
    throw new Error('Remote host platform is unavailable for agent detection')
  }
  const mux = getActiveMultiplexer(connectionId)
  if (!mux || mux.isDisposed()) {
    throw new SshHostNotServedError(connectionId)
  }
  return detectAgentsUsingCommandProbe({
    runtime,
    options,
    expandLocalHome: false,
    detectCommands: async (commands) => {
      const reply = remoteCommandDetection.parse(
        await mux.request('preflight.detectAgents', {
          commands: commands.map((command) => ({ id: command, cmd: command }))
        })
      )
      const detected = new Set(reply.agents)
      return new Set(commands.filter((command) => detected.has(command)))
    }
  })
}
