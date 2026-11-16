import type { SshChannelMultiplexer } from '../ssh/protocol/ssh-channel-multiplexer'
import type { SftpFactory } from './ssh-filesystem-download'
import type { SshRawTransferOptions } from './ssh-filesystem-file-upload'
import { uploadBuffer } from '../ssh/file-transfer/sftp/sftp-upload'
import { isMethodNotFoundError } from '../ssh/ssh-filesystem-stream-reader'
import type { FileBytesWritePrecondition } from '../../shared/file-write/file-bytes-write'
import type {
  FileWriteDiskPrecondition,
  FileWriteResult
} from '../../shared/file-write/file-write-disk-precondition'

export class SshFilesystemMutationProvider {
  constructor(
    protected readonly mux: SshChannelMultiplexer,
    protected readonly createSftp?: SftpFactory,
    protected readonly rawTransfer?: SshRawTransferOptions
  ) {}
  async writeFile(filePath: string, content: string): Promise<void> {
    await this.mux.request('fs.writeFile', { filePath, content })
  }

  async writeFileWithDiskPrecondition(
    filePath: string,
    content: string,
    precondition?: FileWriteDiskPrecondition
  ): Promise<FileWriteResult> {
    return (await this.mux.request('fs.writeFileWithDiskPrecondition', {
      filePath,
      content,
      ...(precondition ? { precondition } : {})
    })) as FileWriteResult
  }

  async commitUpload(tempPath: string, finalPath: string): Promise<void> {
    await this.mux.request('fs.commitUpload', { tempPath, finalPath })
  }

  async replaceWithUpload(
    tempPath: string,
    finalPath: string,
    precondition: FileBytesWritePrecondition
  ): Promise<FileWriteResult> {
    return (await this.mux.request('fs.replaceWithUpload', {
      tempPath,
      finalPath,
      precondition
    })) as FileWriteResult
  }

  async writeFileBase64(filePath: string, contentBase64: string): Promise<void> {
    await this.writeFileBase64Chunk(filePath, contentBase64, false)
  }

  async writeFileBase64Chunk(
    filePath: string,
    contentBase64: string,
    append: boolean
  ): Promise<void> {
    const contents = Buffer.from(contentBase64, 'base64')
    if (this.rawTransfer?.writeBuffer) {
      await this.rawTransfer.writeBuffer(filePath, contents, { append, exclusive: !append })
      return
    }
    if (!this.createSftp) {
      throw new Error('remote_binary_upload_unavailable')
    }
    const sftp = await this.createSftp()
    try {
      // Why: relay fs.writeFile is text-only. SFTP writes the decoded bytes
      // directly so runtime uploads do not corrupt images, PDFs, or archives.
      await uploadBuffer(sftp, contents, filePath, {
        append,
        exclusive: !append
      })
    } finally {
      sftp.end()
    }
  }
  async deletePath(targetPath: string, recursive?: boolean): Promise<void> {
    await this.mux.request('fs.deletePath', { targetPath, recursive })
  }

  async createFile(filePath: string): Promise<void> {
    await this.mux.request('fs.createFile', { filePath })
  }

  async createDir(dirPath: string): Promise<void> {
    await this.mux.request('fs.createDir', { dirPath })
  }

  async createDirNoClobber(dirPath: string): Promise<void> {
    await this.mux.request('fs.createDirNoClobber', { dirPath })
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await this.mux.request('fs.rename', { oldPath, newPath })
  }

  async renameNoClobber(oldPath: string, newPath: string): Promise<void> {
    try {
      await this.mux.request('fs.renameNoClobber', { oldPath, newPath })
    } catch (err) {
      if (isMethodNotFoundError(err)) {
        // Why: falling back to raw fs.rename can silently clobber the target on
        // older relays. Fail closed and let reconnect deploy the safe relay.
        throw new Error('Remote safe rename is unavailable. Reconnect the SSH target and retry.')
      }
      throw err
    }
  }

  async copy(source: string, destination: string): Promise<void> {
    await this.mux.request('fs.copy', { source, destination })
  }
}
