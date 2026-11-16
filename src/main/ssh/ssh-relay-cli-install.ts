import type { SFTPWrapper } from 'ssh2'
import { writeStringViaSftp } from './file-transfer/sftp/sftp-upload'

export async function writeRelayCliFiles(
  connection: { sftp(): Promise<SFTPWrapper> },
  files: readonly { path: string; contents: string }[]
): Promise<void> {
  const sftp = await connection.sftp()
  try {
    for (const file of files) {
      await writeStringViaSftp(sftp, file.path, file.contents)
    }
  } finally {
    sftp.end()
  }
}
