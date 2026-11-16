import type { ChildProcess } from 'node:child_process'
import { forceTerminateProcessTree } from '@orca/process-host/process-tree-termination'

export function terminateRelaySubprocessTree(child: ChildProcess): void {
  void forceTerminateProcessTree(child).catch(() => {})
}
