import { z } from 'zod'
import { getActiveMultiplexer } from '../ssh/targets/ssh-target-registry'
import { SshHostNotServedError } from '../providers/ssh-host-not-served-error'

export type RemoteWindowsTerminalCapabilities = z.infer<typeof remoteWindowsTerminalCapabilities>

const remoteWindowsTerminalCapabilities = z.object({
  wslAvailable: z.boolean(),
  wslDistros: z.array(z.string()),
  pwshAvailable: z.boolean(),
  gitBashAvailable: z.boolean(),
  hostPlatform: z
    .enum([
      'aix',
      'android',
      'darwin',
      'freebsd',
      'haiku',
      'linux',
      'openbsd',
      'sunos',
      'win32',
      'cygwin',
      'netbsd'
    ])
    .nullable()
})

export async function detectRemoteWindowsTerminalCapabilities(args: {
  connectionId: string
}): Promise<RemoteWindowsTerminalCapabilities> {
  const mux = getActiveMultiplexer(args.connectionId)
  if (!mux || mux.isDisposed()) {
    throw new SshHostNotServedError(args.connectionId)
  }
  return remoteWindowsTerminalCapabilities.parse(
    await mux.request('preflight.detectWindowsTerminalCapabilities', {})
  )
}
