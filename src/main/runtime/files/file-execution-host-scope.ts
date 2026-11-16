import { AsyncLocalStorage } from 'node:async_hooks'
import { parseExecutionHostId, type ExecutionHostId } from '../../../shared/execution-host'

const fileExecutionHost = new AsyncLocalStorage<ExecutionHostId | undefined>()

export function currentFileExecutionHost(): ExecutionHostId | undefined {
  return fileExecutionHost.getStore()
}

export function withFileExecutionHost<T>(params: unknown, operation: () => T): T {
  const value =
    typeof params === 'object' && params !== null && 'executionHostId' in params
      ? params.executionHostId
      : undefined
  if (value === undefined) {
    return fileExecutionHost.run(undefined, operation)
  }
  const host = typeof value === 'string' ? parseExecutionHostId(value) : null
  if (!host || host.kind === 'runtime') {
    throw new Error('File execution host is not served by this runtime')
  }
  return fileExecutionHost.run(host.id, operation)
}
