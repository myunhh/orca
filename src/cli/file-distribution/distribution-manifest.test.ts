import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { localDistributionFiles, readDistributionManifest } from './distribution-manifest'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'orca-distribution-test-'))
  roots.push(root)
  await mkdir(join(root, 'code'))
  await writeFile(join(root, 'code', 'train.py'), 'print(42)')
  await writeFile(join(root, 'weights.bin'), Buffer.from([0, 255, 10]))
  await writeFile(join(root, 'private.key'), 'not selected')
  return root
}

describe('distribution source selection', () => {
  it('includes only selected files and deduplicates overlapping paths', async () => {
    const root = await fixture()
    expect(await localDistributionFiles(root, ['code', 'code/train.py', 'weights.bin'])).toEqual([
      'code/train.py',
      'weights.bin'
    ])
  })

  it('refuses parent traversal before reading outside the source', async () => {
    const root = await fixture()
    await expect(localDistributionFiles(join(root, 'code'), ['../private.key'])).rejects.toThrow()
  })

  it.skipIf(process.platform === 'win32')(
    'refuses a selected symlink into private files',
    async () => {
      const root = await fixture()
      await symlink(join(root, 'private.key'), join(root, 'code', 'key'))
      await expect(localDistributionFiles(root, ['code'])).rejects.toThrow()
    }
  )

  it('rejects target names that would merge results on case-insensitive filesystems', async () => {
    const root = await fixture()
    const manifest = join(root, 'distribution.json')
    await writeFile(
      manifest,
      JSON.stringify({
        source: '.',
        inputs: ['code'],
        results: ['results'],
        targets: [
          {
            name: 'GPU-A',
            environment: 'server-a',
            worktree: 'folder:experiment',
            directory: 'run'
          },
          {
            name: 'gpu-a',
            environment: 'server-b',
            worktree: 'folder:experiment',
            directory: 'run'
          }
        ]
      })
    )
    await expect(readDistributionManifest(manifest)).rejects.toThrow()
  })
})
