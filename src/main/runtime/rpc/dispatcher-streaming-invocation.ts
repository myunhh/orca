import type { OrcaRuntimeService } from '../orca-runtime'
import type { OrchestrationEntryCaller } from '../orchestration/addressing/orchestration-caller-identity'
import type { RpcEnvelopeMeta, RpcRequest, RpcResponse, RpcStreamingMethod } from './core'
import {
  rpcContextFromTransport,
  type RpcDispatchStreamingOptions
} from './dispatcher-stream-options'
import { mapDispatcherError } from './dispatcher-error-response'
import { createDispatcherStreamingFeatureEmitter } from './dispatcher-streaming-feature-emitter'
import { recordRuntimeFeatureInteraction } from './runtime-feature-interaction'
import { withFileExecutionHost } from '../files/file-execution-host-scope'

/** Run one admitted stream inside its immutable file-host scope and feature-event lifetime. */
export async function invokeDispatcherStreaming(
  runtime: OrcaRuntimeService,
  admission: {
    request: RpcRequest
    method: RpcStreamingMethod
    params: unknown
    caller: OrchestrationEntryCaller | undefined
  },
  meta: RpcEnvelopeMeta,
  reply: (response: RpcResponse) => void,
  options: RpcDispatchStreamingOptions | undefined
): Promise<void> {
  const { request, method, params, caller } = admission
  const { emit, recordedFeatureInteractions } = createDispatcherStreamingFeatureEmitter(
    runtime,
    request,
    meta,
    reply
  )
  try {
    const result = await withFileExecutionHost(
      request.method.startsWith('files.') ? params : undefined,
      () =>
        method.handler(
          params,
          rpcContextFromTransport(runtime, request, options, caller, params),
          emit
        )
    )
    recordRuntimeFeatureInteraction(
      runtime,
      request.method,
      result,
      recordedFeatureInteractions,
      request.params
    )
  } catch (error) {
    reply(mapDispatcherError(request, meta, error))
  }
}
