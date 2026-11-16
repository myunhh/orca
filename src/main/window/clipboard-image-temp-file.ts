import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import {
  getSshFilesystemProvider,
  requireSshFilesystemProvider
} from '../providers/ssh-filesystem-dispatch'
import { joinWorktreeRelativePath } from '../runtime/files/paths/runtime-relative-paths'
import { getAppEnvironment } from '../../shared/app-environment'
import { assertClipboardImageByteLengthWithinLimit } from '../../shared/clipboard-image'
import {
  agentSessionPastedImageName,
  sanitizeAgentSessionAttachmentName,
  type AgentSessionAttachmentClipboardTarget
} from '../../shared/agent-session/agent-session-attachments'
import { detectImageFileSignature } from '../media/image-file-signature'
import { nativeChatPasteFolder } from './native-chat-paste-files'

export type SaveClipboardImageAsTempFileArgs = {
  connectionId?: string | null
  /** A phone-picked file's own name; without it the paste is named by its image bytes. */
  fileName?: string
  runtimeEnvironmentId?: string | null
  /** With `runtimeEnvironmentId`: store the image as an attachment of this structured chat. */
  agentSessionAttachment?: AgentSessionAttachmentClipboardTarget
  /** A native-chat composer paste: kept in Orca's paste folder so its draft can bring it back. */
  forNativeChatDraft?: boolean
  /** With forNativeChatDraft, sends claim local structured-chat pastes from the chat attachment store. */
  forStructuredChat?: boolean
}

// The path is typed into terminals, so keep no character a shell would expand.
function shellInertFileName(name: string): string {
  return sanitizeAgentSessionAttachmentName(name).replace(/[^\p{L}\p{M}\p{N} ._-]/gu, '_')
}

export async function saveClipboardImageBufferAsTempFile(
  buffer: Buffer,
  args?: SaveClipboardImageAsTempFileArgs
): Promise<string> {
  assertClipboardImageByteLengthWithinLimit(buffer.byteLength)

  if (args?.connectionId != null) {
    const connectionId = args.connectionId
    const provider = requireSshFilesystemProvider(connectionId)
    if (!provider.getTempDir) {
      throw new Error('Clipboard image uploads require a newer SSH relay')
    }
    const folder = await provider.getTempDir()
    const directory = joinWorktreeRelativePath(folder, `orca-paste-${randomUUID()}`)
    await provider.createDirNoClobber(directory)
    const fileName = args.fileName
      ? shellInertFileName(args.fileName)
      : agentSessionPastedImageName(
          Date.now(),
          randomUUID(),
          detectImageFileSignature(buffer)?.extension
        )
    const remotePath = joinWorktreeRelativePath(directory, fileName)
    try {
      await provider.createFile(remotePath)
      for (let offset = 0; offset < buffer.length; offset += 512 * 1024) {
        if (getSshFilesystemProvider(connectionId) !== provider) {
          throw new Error('SSH clipboard connection changed')
        }
        await provider.writeFileBase64Chunk(
          remotePath,
          buffer.subarray(offset, offset + 512 * 1024).toString('base64'),
          true
        )
      }
      if (getSshFilesystemProvider(connectionId) !== provider) {
        throw new Error('SSH clipboard connection changed')
      }
      return remotePath
    } catch (error) {
      await provider.deletePath(directory, true).catch(() => undefined)
      throw error
    }
  }

  // Composer drafts must restore pastes after restart; terminal/editor/phone pastes use OS temp.
  let folder = getAppEnvironment().getPath('temp')
  if (args?.forNativeChatDraft === true) {
    folder = nativeChatPasteFolder()
    await fs.mkdir(folder, { recursive: true })
  }
  // A picked file keeps its own name, so the paste gets a folder to stay unique.
  const tempPath = args?.fileName
    ? path.join(folder, `orca-paste-${randomUUID()}`, shellInertFileName(args.fileName))
    : path.join(
        folder,
        // Phone library picks are often JPEG; agents trust the extension over the bytes.
        agentSessionPastedImageName(
          Date.now(),
          randomUUID(),
          detectImageFileSignature(buffer)?.extension
        )
      )
  if (args?.fileName) {
    await fs.mkdir(path.dirname(tempPath), { recursive: true })
  }
  await fs.writeFile(tempPath, buffer)
  return tempPath
}
