import { constants, copyFile, lstat, mkdir, realpath, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { z } from 'zod'
import { expandTilde } from './context'
import type { RelayDispatcher } from './dispatcher'
import { writeLocalTextFileWithDiskPrecondition } from '../main/ipc/filesystem/local-disk-write-precondition'
import { replaceLocalFileBytesIfUnchanged } from '../main/ipc/filesystem/local-disk-bytes-replace'
import {
  FileReplaceWithUpload,
  FileWriteDiskPreconditionParam
} from '../shared/rpc-contract/files-mutation-params'

const pathSchema = z.string().min(1)
const uploadSchema = z.object({ tempPath: pathSchema, finalPath: pathSchema })
const replacementSchema = uploadSchema.extend({
  precondition: FileReplaceWithUpload.shape.bytesPrecondition
})
const textWriteSchema = z.object({
  filePath: pathSchema,
  content: z.string(),
  precondition: FileWriteDiskPreconditionParam.optional()
})

async function uploadPaths(params: z.infer<typeof uploadSchema>) {
  const tempPath = expandTilde(params.tempPath)
  const finalPath = expandTilde(params.finalPath)
  const source = await lstat(tempPath)
  if (!source.isFile()) {
    throw new Error('The uploaded source must be a regular file')
  }
  const sourceRealPath = await realpath(tempPath)
  const finalRealPath = await realpath(finalPath).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return resolve(finalPath)
    }
    throw error
  })
  const normalize = (path: string) => (process.platform === 'win32' ? path.toLowerCase() : path)
  if (normalize(sourceRealPath) === normalize(finalRealPath)) {
    throw new Error('The uploaded source and destination must be different files')
  }
  return { tempPath, finalPath }
}

export function registerRelayUploadPublication(dispatcher: RelayDispatcher): void {
  dispatcher.onRequest('fs.writeFileWithDiskPrecondition', async (params) => {
    const input = textWriteSchema.parse(params)
    return writeLocalTextFileWithDiskPrecondition(
      expandTilde(input.filePath),
      input.content,
      input.precondition
    )
  })
  dispatcher.onRequest('fs.commitUpload', async (params) => {
    const { tempPath, finalPath } = await uploadPaths(uploadSchema.parse(params))
    await mkdir(dirname(finalPath), { recursive: true })
    await copyFile(tempPath, finalPath, constants.COPYFILE_EXCL)
    await rm(tempPath, { force: true })
    return { ok: true }
  })
  dispatcher.onRequest('fs.replaceWithUpload', async (params) => {
    const input = replacementSchema.parse(params)
    const { tempPath, finalPath } = await uploadPaths(input)
    try {
      return await replaceLocalFileBytesIfUnchanged(
        finalPath,
        (replacement) => copyFile(tempPath, replacement, constants.COPYFILE_EXCL),
        input.precondition
      )
    } finally {
      await rm(tempPath, { force: true })
    }
  })
}
