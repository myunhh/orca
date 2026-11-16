import { randomUUID } from 'node:crypto'
import { open, mkdir, link, rm, lstat } from 'node:fs/promises'
import { dirname, join, resolve, relative, isAbsolute, sep, posix } from 'node:path'
import { z } from 'zod'
import type { RuntimeClient } from '../runtime-client'
import {
  FILE_BYTES_WRITE_CHUNK_BYTES,
  FILE_REPLACE_WITH_UPLOAD_METHOD
} from '../../shared/file-write/file-bytes-write'
import {
  assertFileWriteApplied,
  type FileWriteResult
} from '../../shared/file-write/file-write-disk-precondition'
import { DistributionPath } from './distribution-manifest'

export type DistributionEndpoint = {
  client: Pick<RuntimeClient, 'call'>
  scope: {
    worktree: string
    executionHostId?: string
    expectedExecutionHostId?: string
    expectedSshTargetId?: string
    expectedSshConnectionGeneration?: number
  }
}
const Entry = z.object({
  name: z.string().min(1),
  isDirectory: z.boolean(),
  isSymlink: z.boolean()
})
const Page = z.object({ entries: z.array(Entry), total: z.number(), hasMore: z.boolean() })
const Chunk = z.object({
  contentBase64: z.string(),
  bytesRead: z.number().int().nonnegative(),
  eof: z.boolean()
})

async function directoryEntries(
  endpoint: DistributionEndpoint,
  relativePath: string
): Promise<z.infer<typeof Entry>[]> {
  const entries: z.infer<typeof Entry>[] = []
  let after: { name: string; isDirectory: boolean } | undefined
  for (;;) {
    const response = await endpoint.client.call('files.readDir', {
      ...endpoint.scope,
      relativePath: relativePath === '.' ? '' : relativePath,
      followSymlinks: false,
      limit: 500,
      after
    })
    const page = Page.parse(response.result)
    for (const entry of page.entries) {
      DistributionPath.parse(entry.name)
      if (entry.name.includes('/')) {
        throw new Error('Invalid directory entry received from host')
      }
      entries.push(entry)
    }
    if (!page.hasMore) {
      return entries
    }
    const last = page.entries.at(-1)
    if (!last || (after?.name === last.name && after.isDirectory === last.isDirectory)) {
      throw new Error('Host returned a non-advancing directory page')
    }
    after = { name: last.name, isDirectory: last.isDirectory }
  }
}

export async function remoteDistributionFiles(
  endpoint: DistributionEndpoint,
  paths: readonly string[]
): Promise<string[]> {
  const files = new Set<string>()
  async function visit(path: string, entry: z.infer<typeof Entry>): Promise<void> {
    if (entry.isSymlink) {
      throw new Error(`Symbolic links are not collected: ${path}`)
    }
    if (entry.isDirectory) {
      for (const child of await directoryEntries(endpoint, path)) {
        await visit(`${path}/${child.name}`, child)
      }
    } else {
      files.add(path)
    }
  }
  for (const path of paths) {
    DistributionPath.parse(path)
    const entries = await directoryEntries(endpoint, posix.dirname(path))
    const entry = entries.find((candidate) => candidate.name === posix.basename(path))
    if (!entry) {
      throw new Error(`Result path does not exist: ${path}`)
    }
    await visit(path, entry)
  }
  return [...files].sort()
}

async function ensureDistributionDirectory(
  endpoint: DistributionEndpoint,
  directory: string
): Promise<void> {
  if (directory === '.') {
    return
  }
  let parent = '.'
  for (const name of directory.split('/')) {
    const entry = (await directoryEntries(endpoint, parent)).find((entry) => entry.name === name)
    const path = posix.join(parent, name)
    if (entry) {
      if (!entry.isDirectory || entry.isSymlink) {
        throw new Error(`Not a regular destination directory: ${path}`)
      }
    } else {
      await endpoint.client.call('files.createDir', { ...endpoint.scope, relativePath: path })
    }
    parent = path
  }
}

export async function uploadDistributionFile(
  endpoint: DistributionEndpoint,
  localPath: string,
  destination: string,
  overwrite: boolean
): Promise<void> {
  const temporary = posix.join(posix.dirname(destination), `.orca-upload-${randomUUID()}`)
  const file = await open(localPath, 'r')
  let ownsTemporary = false
  let failure: unknown
  try {
    const before = await file.stat()
    if (!before.isFile()) {
      throw new Error(`Not a regular source file: ${localPath}`)
    }
    await ensureDistributionDirectory(endpoint, posix.dirname(destination))
    const buffer = Buffer.allocUnsafe(FILE_BYTES_WRITE_CHUNK_BYTES)
    let offset = 0
    for (;;) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, offset)
      if (!bytesRead && offset > 0) {
        break
      }
      await endpoint.client.call('files.writeBase64Chunk', {
        ...endpoint.scope,
        relativePath: temporary,
        contentBase64: buffer.subarray(0, bytesRead).toString('base64'),
        append: ownsTemporary
      })
      ownsTemporary = true
      offset += bytesRead
      if (!bytesRead) {
        break
      }
    }
    const after = await file.stat()
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || offset !== before.size) {
      throw new Error(`Source changed during upload: ${localPath}`)
    }
    const result = await endpoint.client.call<FileWriteResult>(
      overwrite ? FILE_REPLACE_WITH_UPLOAD_METHOD : 'files.commitUpload',
      {
        ...endpoint.scope,
        tempRelativePath: temporary,
        finalRelativePath: destination,
        ...(overwrite ? { bytesPrecondition: { allowMissing: true } } : {})
      }
    )
    assertFileWriteApplied(result.result)
    ownsTemporary = false
  } catch (error) {
    failure = error
  } finally {
    await file.close()
    if (ownsTemporary) {
      try {
        await endpoint.client.call('files.delete', { ...endpoint.scope, relativePath: temporary })
      } catch (error) {
        failure = new AggregateError(
          [failure, error],
          `Transfer failed; temporary upload may remain at ${temporary}`
        )
      }
    }
  }
  if (failure) {
    throw failure
  }
}

async function prepareCollectionParent(root: string, path: string): Promise<string> {
  const destination = resolve(root, path)
  const inside = relative(root, destination)
  if (isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`)) {
    throw new Error('Collection path leaves output directory')
  }
  let current = root
  for (const part of relative(root, dirname(destination)).split(sep).filter(Boolean)) {
    current = join(current, part)
    await mkdir(current, { recursive: true })
    const stat = await lstat(current)
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`Unsafe collection directory: ${current}`)
    }
  }
  return destination
}

export async function collectDistributionFile(
  endpoint: DistributionEndpoint,
  source: string,
  outputRoot: string,
  outputPath: string
): Promise<void> {
  const destination = await prepareCollectionParent(outputRoot, outputPath)
  const temporary = join(dirname(destination), `.orca-download-${randomUUID()}`)
  const file = await open(temporary, 'wx', 0o600)
  try {
    let offset = 0
    for (;;) {
      const response = await endpoint.client.call('files.readChunk', {
        ...endpoint.scope,
        relativePath: source,
        offset,
        length: FILE_BYTES_WRITE_CHUNK_BYTES
      })
      const chunk = Chunk.parse(response.result)
      const bytes = Buffer.from(chunk.contentBase64, 'base64')
      if (
        bytes.length !== chunk.bytesRead ||
        bytes.length > FILE_BYTES_WRITE_CHUNK_BYTES ||
        (!chunk.eof && !bytes.length)
      ) {
        throw new Error(`Invalid file chunk received for ${source}`)
      }
      await file.writeFile(bytes)
      offset += bytes.length
      if (chunk.eof) {
        break
      }
    }
    await file.close()
    await link(temporary, destination)
  } finally {
    await file.close()
    await rm(temporary, { force: true })
  }
}
