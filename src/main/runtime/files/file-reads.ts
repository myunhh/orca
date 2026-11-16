import { extname } from 'node:path'
import type { RuntimeFileCommandHost } from './file-command-host'
import type {
  RuntimeFileReadResult,
  RuntimeFilePreviewResult,
  RuntimeFileReadChunkResult
} from '../../../shared/file-content/runtime-file-read'
import { isMobileBinaryPath, isSafeMobileRelativePath } from './mobile-file-kind'
import { joinWorktreeRelativePath } from './paths/runtime-relative-paths'
import { truncateMobileFilePreview } from '../terminal/artifacts/artifact-integrity'
import {
  requireLocalRuntimeFileRoute,
  requireRuntimeFileProvider,
  resolveFileExplorerPath,
  resolveFileExplorerPaths,
  runtimeFileRouteForTarget
} from './file-target'
import {
  LOCAL_PREVIEWABLE_BINARY_MAX_BYTES,
  MOBILE_FILE_READ_MAX_BYTES,
  RUNTIME_PREVIEWABLE_BINARY_MIME_TYPES,
  assertPreviewWithinTransportBudget,
  previewableBinaryByteLimit
} from './file-preview-budget'
import {
  assertFileReadRange,
  fileRangePage,
  readLocalFileRange
} from '../../ipc/filesystem/local-file-range-read'
import { windowsFsPath } from '../../wsl/filesystem/wsl-unc-drive-fs-path'
import { guardWslUncPathAccess } from '../../wsl/filesystem/wsl-unc-access-gate'
import { resolveLocalFileRequestPath } from '../../ipc/filesystem/access/local-file-access-resolution'
import type { LocalFileAccess } from '../../../shared/file-access/local-file-access'
import { filePreviewForPath } from '../../../shared/file-preview/file-preview-kind'
import { resolveRuntimeAuthorizedPath } from './chat-scratch-file-root'
import { readPreviewBytes, readLocalMobileFile } from './local-file-reads'
import { isBinaryBuffer } from '../../../shared/file-preview/binary-buffer'
import type {
  DocPreviewFileAccessResult,
  DocPreviewFileChunk,
  DocPreviewFileTarget
} from '../../../shared/document-preview/doc-preview-file-access'
import type { IFilesystemProvider } from '../../providers/filesystem-provider-contract'
import { requireSshFilesystemProvider } from '../../providers/ssh-filesystem-dispatch'

const CHAT_IMAGE_ACCESS: LocalFileAccess = { kind: 'chat-image' }

type RuntimeFileReadHost = Pick<RuntimeFileCommandHost, 'requireStore' | 'resolveRuntimeFileTarget'>

export class RuntimeFileReads {
  constructor(private readonly host: RuntimeFileReadHost) {}

  async readMobileFile(
    worktreeSelector: string,
    relativePath: string
  ): Promise<RuntimeFileReadResult> {
    const store = this.host.requireStore()
    const target = await this.host.resolveRuntimeFileTarget(worktreeSelector)
    const { worktree } = target
    if (!isSafeMobileRelativePath(relativePath)) {
      throw new Error('invalid_relative_path')
    }
    if (isMobileBinaryPath(relativePath)) {
      throw new Error('binary_file')
    }

    const filePath = joinWorktreeRelativePath(worktree.path, relativePath)
    let content: string
    const route = runtimeFileRouteForTarget(target)
    if (route.kind === 'ssh') {
      const result = await requireSshFilesystemProvider(route.connectionId).readFile(filePath, {
        maxTextBytes: MOBILE_FILE_READ_MAX_BYTES
      })
      if (result.isBinary) {
        throw new Error('binary_file')
      }
      content = result.content
    } else {
      content = await readLocalMobileFile(filePath, store)
    }
    const truncated = truncateMobileFilePreview(content)

    return {
      worktree: worktree.id,
      relativePath,
      content: truncated.content,
      truncated: truncated.truncated,
      byteLength: truncated.byteLength
    }
  }

  async readFileExplorerPreview(
    worktreeSelector: string,
    relativePath: string,
    maxContentBytes?: number
  ): Promise<RuntimeFilePreviewResult> {
    const target = await resolveFileExplorerPath(this.host, worktreeSelector, relativePath)
    const route = runtimeFileRouteForTarget(target)
    if (route.kind === 'ssh') {
      return assertPreviewWithinTransportBudget(
        await requireSshFilesystemProvider(route.connectionId).readFile(target.path, {
          maxTextBytes: MOBILE_FILE_READ_MAX_BYTES,
          maxBinaryBytes: binaryPreviewMaxBytes(maxContentBytes)
        }),
        maxContentBytes
      )
    }
    requireLocalRuntimeFileRoute(target)
    const filePath = await resolveRuntimeAuthorizedPath(target.path, this.host.requireStore())
    const mimeType = RUNTIME_PREVIEWABLE_BINARY_MIME_TYPES[extname(filePath).toLowerCase()]
    const buffer = await readPreviewBytes(
      filePath,
      mimeType ? binaryPreviewMaxBytes(maxContentBytes) : MOBILE_FILE_READ_MAX_BYTES
    )
    if (mimeType) {
      return assertPreviewWithinTransportBudget(
        { content: buffer.toString('base64'), isBinary: true, isImage: true, mimeType },
        maxContentBytes
      )
    }

    if (isBinaryBuffer(buffer)) {
      return assertPreviewWithinTransportBudget({ content: '', isBinary: true }, maxContentBytes)
    }
    return assertPreviewWithinTransportBudget(
      { content: buffer.toString('utf-8'), isBinary: false },
      maxContentBytes
    )
  }

  async readDocPreviewFile(
    worktreeSelector: string,
    relativePath: string,
    entryRelativePath: string,
    implicitRootRelativePath: string | null,
    authorizedRootRelativePaths: string[],
    maxContentBytes?: number
  ): Promise<DocPreviewFileAccessResult> {
    const { target, provider } = await this.resolveDocPreviewTarget(
      worktreeSelector,
      relativePath,
      entryRelativePath,
      implicitRootRelativePath,
      authorizedRootRelativePaths
    )
    if (!provider.readDocPreviewFile) {
      throw new Error('Secure document previews require a newer SSH relay')
    }
    return assertPreviewWithinTransportBudget(
      await provider.readDocPreviewFile({
        ...target,
        maxTextBytes: MOBILE_FILE_READ_MAX_BYTES,
        maxBinaryBytes: binaryPreviewMaxBytes(maxContentBytes)
      }),
      maxContentBytes
    )
  }

  async readDocPreviewChunk(
    worktreeSelector: string,
    relativePath: string,
    entryRelativePath: string,
    implicitRootRelativePath: string | null,
    authorizedRootRelativePaths: string[],
    offset: number,
    length: number
  ): Promise<DocPreviewFileChunk> {
    const { target, provider } = await this.resolveDocPreviewTarget(
      worktreeSelector,
      relativePath,
      entryRelativePath,
      implicitRootRelativePath,
      authorizedRootRelativePaths
    )
    if (!provider.readDocPreviewFileChunk) {
      throw new Error('Secure document previews require a newer SSH relay')
    }
    return provider.readDocPreviewFileChunk(target, offset, length)
  }

  private async resolveDocPreviewTarget(
    worktreeSelector: string,
    relativePath: string,
    entryRelativePath: string,
    implicitRootRelativePath: string | null,
    authorizedRootRelativePaths: string[]
  ): Promise<{
    target: DocPreviewFileTarget
    provider: Pick<IFilesystemProvider, 'readDocPreviewFile' | 'readDocPreviewFileChunk'>
  }> {
    const relativePaths = [
      '',
      entryRelativePath,
      relativePath,
      ...(implicitRootRelativePath === null ? [] : [implicitRootRelativePath]),
      ...authorizedRootRelativePaths
    ]
    const [boundary, entry, target, ...authorityRoots] = await resolveFileExplorerPaths(
      this.host,
      worktreeSelector,
      relativePaths
    )
    const implicitRoot = implicitRootRelativePath === null ? null : authorityRoots[0]
    const authorizedRoots = authorityRoots.slice(implicitRoot === null ? 0 : 1)
    return {
      target: {
        boundaryPath: boundary.path,
        entryPath: entry.path,
        implicitRootPath: implicitRoot?.path ?? null,
        authorizedRootPaths: authorizedRoots.map((root) => root.path),
        targetPath: target.path
      },
      provider: requireRuntimeFileProvider(target, this.host)
    }
  }

  async readFileExplorerChunk(
    worktreeSelector: string,
    relativePath: string,
    offset: number,
    length: number
  ): Promise<RuntimeFileReadChunkResult> {
    const target = await resolveFileExplorerPath(this.host, worktreeSelector, relativePath)
    assertFileReadRange(offset, length)
    const route = runtimeFileRouteForTarget(target)
    if (route.kind === 'ssh') {
      const provider = requireSshFilesystemProvider(route.connectionId)
      if (!provider.readFileRange) {
        throw new Error('File range reads require a newer SSH relay')
      }
      const info = await provider.stat(target.path)
      if (info.type !== 'file') {
        throw new Error('not_a_file')
      }
      const range = await provider.readFileRange(target.path, offset, length)
      return fileRangePage(range.bytes.subarray(0, range.bytesRead), offset, info.size)
    }
    requireLocalRuntimeFileRoute(target)
    const filePath = await resolveRuntimeAuthorizedPath(target.path, this.host.requireStore())
    return readLocalFileRange(filePath, offset, length)
  }

  /** A host image a chat names, under desktop's chat-image rule; the path must be on this machine. */
  async readChatImagePreview(
    worktreeSelector: string,
    filePath: string,
    maxContentBytes?: number
  ): Promise<RuntimeFilePreviewResult> {
    requireLocalRuntimeFileRoute(await this.host.resolveRuntimeFileTarget(worktreeSelector))
    const store = this.host.requireStore()
    // Automatic loads never wake a stopped WSL distro.
    return guardWslUncPathAccess(filePath, async () => {
      const imagePath = await resolveLocalFileRequestPath(filePath, CHAT_IMAGE_ACCESS, store)
      // Paths inside project roots skip the rule's type check.
      const preview = filePreviewForPath(imagePath)
      if (preview?.kind !== 'image') {
        throw new Error('not_an_image')
      }
      const { mimeType } = preview
      const buffer = await readPreviewBytes(
        windowsFsPath(imagePath),
        binaryPreviewMaxBytes(maxContentBytes),
        { regularFileOnly: true }
      )
      return assertPreviewWithinTransportBudget(
        { content: buffer.toString('base64'), isBinary: true, isImage: true, mimeType },
        maxContentBytes
      )
    })
  }
}

function binaryPreviewMaxBytes(maxContentBytes: number | undefined): number {
  return maxContentBytes === undefined
    ? LOCAL_PREVIEWABLE_BINARY_MAX_BYTES
    : previewableBinaryByteLimit(maxContentBytes)
}
