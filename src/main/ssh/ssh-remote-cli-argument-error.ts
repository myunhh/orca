export type ParsedRemoteCli = {
  commandPath: string[]
  flags: Map<string, string | boolean>
}

export class RemoteCliArgumentError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'RemoteCliArgumentError'
    this.code = code
  }
}

export const VALUELESS_RETRY_REQUEST_GUIDANCE =
  '--retry-request requires a value; it was passed with none.'
