import type { MultiplexerWriteSettlement } from './protocol/ssh-multiplexer-transport-writer'
import {
  WRITE_ACCEPTED,
  writeRefused,
  writeUnverifiable,
  type WriteSettlement
} from '../../shared/terminal/pty/lifecycle/pty-write-settlement'

export function toWriteSettlement(result: MultiplexerWriteSettlement): WriteSettlement {
  if (result.outcome === 'accepted') {
    return WRITE_ACCEPTED
  }
  return result.outcome === 'refused'
    ? writeRefused(result.reason)
    : writeUnverifiable(result.reason, result.bytesHandedToTransport)
}
