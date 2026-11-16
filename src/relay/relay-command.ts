import { runProcess } from '@orca/process-host'
import type { ProcessSpec, ProcessResult } from '@orca/process-host/process-spec'

export async function runRelayCommand(spec: ProcessSpec): Promise<ProcessResult> {
  const result = await runProcess({
    ...spec,
    timeoutMs: spec.timeoutMs ?? null,
    killOnOutputLimit: true
  })
  if (result.code === 0 && !result.timedOut && !result.outputTruncated && !spec.signal?.aborted) {
    return result
  }
  const error = new Error(
    result.timedOut
      ? `${spec.program} timed out`
      : spec.signal?.aborted
        ? 'The operation was aborted'
        : result.outputTruncated
          ? `${spec.program} output exceeded the capture limit`
          : result.stderr.trim() || `${spec.program} exited with code ${result.code}`
  )
  if (spec.signal?.aborted) {
    error.name = 'AbortError'
  }
  throw Object.assign(error, {
    code: result.outputTruncated ? 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' : result.code,
    killed: result.timedOut || result.signal !== null || spec.signal?.aborted === true,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr
  })
}
