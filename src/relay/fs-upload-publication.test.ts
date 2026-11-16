import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RelayDispatcher } from './dispatcher'
import { FrameDecoder, MessageType, encodeJsonRpcFrame, parseJsonRpcMessage } from './protocol'
import { registerRelayUploadPublication } from './fs-upload-publication'

describe('relay file publication over the real dispatcher', () => {
  let directory: string
  let dispatcher: RelayDispatcher
  let sequence: number
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'orca-relay-upload-'))
    sequence = 0
    const decoder = new FrameDecoder((frame) => {
      if (frame.type !== MessageType.Regular) {
        return
      }
      const message = parseJsonRpcMessage(frame.payload)
      if (!('id' in message)) {
        return
      }
      const request = pending.get(message.id)
      if (!request) {
        return
      }
      pending.delete(message.id)
      if ('error' in message && message.error) {
        request.reject(new Error(message.error.message))
      } else if ('result' in message) {
        request.resolve(message.result)
      }
    })
    dispatcher = new RelayDispatcher((data) => {
      decoder.feed(data)
      return true
    })
    registerRelayUploadPublication(dispatcher)
  })

  afterEach(async () => {
    dispatcher.dispose()
    pending.clear()
    await rm(directory, { recursive: true, force: true })
  })

  function request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = ++sequence
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      dispatcher.feed(encodeJsonRpcFrame({ jsonrpc: '2.0', id, method, params }, id, 0))
    })
  }

  it('publishes an upload but never overwrites an existing destination', async () => {
    const tempPath = join(directory, 'upload.tmp')
    const finalPath = join(directory, 'bytes.bin')
    await writeFile(tempPath, Buffer.from([0, 1, 255]))
    await request('fs.commitUpload', { tempPath, finalPath })
    expect(await readFile(finalPath)).toEqual(Buffer.from([0, 1, 255]))
    await expect(readFile(tempPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await writeFile(tempPath, 'different')
    await expect(request('fs.commitUpload', { tempPath, finalPath })).rejects.toThrow()
    expect(await readFile(finalPath)).toEqual(Buffer.from([0, 1, 255]))
    expect(await readFile(tempPath, 'utf8')).toBe('different')
  })

  it('refuses a stale byte replacement and removes the uploaded temp file', async () => {
    const tempPath = join(directory, 'upload.tmp')
    const finalPath = join(directory, 'bytes.bin')
    await writeFile(finalPath, 'newer disk bytes')
    await writeFile(tempPath, 'older editor bytes')
    expect(
      await request('fs.replaceWithUpload', {
        tempPath,
        finalPath,
        precondition: { expectedSha256: '0'.repeat(64) }
      })
    ).toEqual({ ok: false, diskConflict: 'changed' })
    expect(await readFile(finalPath, 'utf8')).toBe('newer disk bytes')
    await expect(readFile(tempPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('replaces bytes on explicit overwrite and removes the uploaded temp file', async () => {
    const tempPath = join(directory, 'upload.tmp')
    const finalPath = join(directory, 'bytes.bin')
    await writeFile(finalPath, 'before')
    await writeFile(tempPath, Buffer.from([0, 1, 255]))
    expect(
      await request('fs.replaceWithUpload', {
        tempPath,
        finalPath,
        precondition: {}
      })
    ).toEqual({ ok: true })
    expect(await readFile(finalPath)).toEqual(Buffer.from([0, 1, 255]))
    await expect(readFile(tempPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('enforces the text disk precondition on the host', async () => {
    const filePath = join(directory, 'text.txt')
    expect(
      await request('fs.writeFileWithDiskPrecondition', {
        filePath,
        content: 'original'
      })
    ).toEqual({ ok: true })
    expect(
      await request('fs.writeFileWithDiskPrecondition', {
        filePath,
        content: 'overwritten',
        precondition: { expectedSignature: 'stale' }
      })
    ).toEqual({ ok: false, diskConflict: 'changed' })
    expect(await readFile(filePath, 'utf8')).toBe('original')
  })
})
