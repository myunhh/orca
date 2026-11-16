import { throwIfSignalAborted, waitForPromiseWithSignal } from '../../shared/abort-signal-reason'
import { isWslUncPath } from '../../shared/wsl-paths'
import { runWslTranscriptFsTask, type WslTranscriptFsTaskPriority } from './wsl-transcript-fs-gate'
import { runWslTranscriptFsProcess } from './wsl-transcript-fs-process-dispatch'
import type { WslTranscriptFsReusableProcessCall } from './wsl-transcript-fs-process-protocol'
import { wslTranscriptFsLaneKey } from './wsl-transcript-fs-route'
import { admitWslTranscriptPath } from './wsl-transcript-running-admission'

// One request defines both route/dedup identity and child operation, preventing mismatches.
export function runReusableFsOperation<T>(
  request: WslTranscriptFsReusableProcessCall,
  priority: WslTranscriptFsTaskPriority,
  signal: AbortSignal | undefined,
  localTask: () => Promise<T>
): Promise<T> {
  throwIfSignalAborted(signal)
  const pending = isWslUncPath(request.path)
    ? admitWslTranscriptPath(request.path).then(() =>
        runWslTranscriptFsTask(
          { operation: request.operation, path: request.path, priority, signal },
          async (taskSignal) => {
            // Queued work runs later: ask again right before the touch.
            await waitForPromiseWithSignal(admitWslTranscriptPath(request.path), taskSignal)
            return runWslTranscriptFsProcess<T>(
              request,
              taskSignal,
              wslTranscriptFsLaneKey(request.path, priority)
            )
          }
        )
      )
    : localTask()
  return waitForPromiseWithSignal(pending, signal)
}
