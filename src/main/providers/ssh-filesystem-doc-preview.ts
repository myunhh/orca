import type {
  DocPreviewFileAccessRequest,
  DocPreviewFileAccessResult,
  DocPreviewFileChunk,
  DocPreviewFileTarget
} from '../../shared/document-preview/doc-preview-file-access'
import type { SshChannelMultiplexer } from '../ssh/protocol/ssh-channel-multiplexer'
import { isMethodNotFoundError } from '../ssh/ssh-filesystem-stream-reader'

const REMOTE_DOC_PREVIEW_UPDATE_REQUIRED =
  'Secure document previews require a newer SSH relay. Reconnect the SSH target and try again.'

export async function readSshDocPreviewFile(
  mux: SshChannelMultiplexer,
  request: DocPreviewFileAccessRequest
): Promise<DocPreviewFileAccessResult> {
  try {
    return (await mux.request('fs.readDocPreview', request)) as DocPreviewFileAccessResult
  } catch (error) {
    if (isMethodNotFoundError(error)) {
      throw new Error(REMOTE_DOC_PREVIEW_UPDATE_REQUIRED)
    }
    throw error
  }
}

export async function readSshDocPreviewFileChunk(
  mux: SshChannelMultiplexer,
  request: DocPreviewFileTarget,
  offset: number,
  length: number
): Promise<DocPreviewFileChunk> {
  try {
    return (await mux.request('fs.readDocPreviewChunk', {
      ...request,
      offset,
      length
    })) as DocPreviewFileChunk
  } catch (error) {
    if (isMethodNotFoundError(error)) {
      throw new Error(REMOTE_DOC_PREVIEW_UPDATE_REQUIRED)
    }
    throw error
  }
}
