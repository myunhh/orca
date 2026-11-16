import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Store } from '../../persistence/loading-store/store'
import { closeTestStores, createSqliteTestStore } from '../../persistence/persistence-test-harness'
import { OrcaRuntimeService } from '../orca-runtime'
import { RpcDispatcher } from '../rpc/dispatcher'
import { FILE_METHODS } from '../rpc/methods/files/files'
import {
  RuntimeClient,
  RuntimeRpcFailureError,
  type RuntimeRpcSuccess
} from '../../../cli/runtime-client'
import { FILE_DISTRIBUTION_HANDLERS } from '../../../cli/handlers/file-distribution'
import { addEnvironmentFromPairingCode } from '../../../cli/runtime/environments'
import { encodePairingOffer } from '../../../shared/remote-runtime/pairing/pairing'
import {
  collectDistributionFile,
  remoteDistributionFiles,
  uploadDistributionFile,
  type DistributionEndpoint
} from '../../../cli/file-distribution/distribution-transfer'

let root = ''
const initialExitCode = process.exitCode
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  process.exitCode = initialExitCode
  await closeTestStores()
  if (root) {
    await rm(root, { recursive: true, force: true })
  }
})

it('deploys and collects binary files through real filesystem RPC without overwriting by default', async () => {
  vi.stubEnv('ORCA_CLI_CWD', '')
  root = await mkdtemp(join(tmpdir(), 'orca-distribution-smoke-'))
  const source = join(root, 'input.bin')
  const bytes = Buffer.alloc(900_001, 0xa7)
  bytes[0] = 0
  bytes[900_000] = 255
  await writeFile(source, bytes)
  const output = join(root, 'output')
  await mkdir(output)
  for (const name of ['a', 'b']) {
    const host = join(root, name)
    await mkdir(host)
    const store = createSqliteTestStore(Store, {
      dataFile: join(root, `state-${name}`, 'data.json')
    })
    const group = store.createProjectGroup({ name, parentPath: host, createdFrom: 'manual' })
    const folder = store.createFolderWorkspace({ projectGroupId: group.id, name, folderPath: host })
    const dispatcher = new RpcDispatcher({
      runtime: new OrcaRuntimeService(store),
      methods: FILE_METHODS
    })
    const endpoint: DistributionEndpoint = {
      scope: { worktree: `folder:${folder.id}`, expectedExecutionHostId: 'local' },
      client: {
        async call<T>(method: string, params: unknown) {
          const response = await dispatcher.dispatch({
            id: 'smoke',
            authToken: 'smoke',
            method,
            params
          })
          if (!response.ok) {
            throw new RuntimeRpcFailureError(response)
          }
          return response as RuntimeRpcSuccess<T>
        }
      }
    }
    addEnvironmentFromPairingCode(root, {
      name,
      pairingCode: encodePairingOffer({
        v: 2,
        endpoint: `ws://127.0.0.1:${name === 'a' ? 6768 : 6769}`,
        deviceToken: `fixture-token-${name}`,
        publicKeyB64: Buffer.alloc(32, name.charCodeAt(0)).toString('base64'),
        scope: 'runtime'
      })
    })
    const manifest = join(root, `distribution-${name}.json`)
    await writeFile(
      manifest,
      JSON.stringify({
        source: '.',
        inputs: ['input.bin'],
        results: ['input.bin'],
        targets: [
          { name, environment: name, worktree: `folder:${folder.id}`, directory: 'experiment' }
        ]
      })
    )
    const transport = vi
      .spyOn(RuntimeClient.prototype, 'call')
      .mockImplementation(endpoint.client.call)
    await FILE_DISTRIBUTION_HANDLERS['file deploy']({
      cwd: root,
      client: new RuntimeClient(root, 60_000, null, null),
      flags: new Map<string, string | boolean>([
        ['manifest', manifest],
        ['apply', true]
      ]),
      json: true
    })
    transport.mockRestore()
    expect(await readFile(join(host, 'experiment/input.bin'))).toEqual(bytes)
    await expect(
      uploadDistributionFile(endpoint, source, 'experiment/input.bin', false)
    ).rejects.toThrow()
    await writeFile(join(host, 'experiment/input.bin'), 'old')
    await uploadDistributionFile(endpoint, source, 'experiment/input.bin', true)
    expect(await readFile(join(host, 'experiment/input.bin'))).toEqual(bytes)
    expect(await remoteDistributionFiles(endpoint, ['experiment'])).toEqual([
      'experiment/input.bin'
    ])
    await collectDistributionFile(endpoint, 'experiment/input.bin', output, `${name}/result.bin`)
    expect(await readFile(join(output, name, 'result.bin'))).toEqual(bytes)
    await expect(
      collectDistributionFile(endpoint, 'experiment/input.bin', output, `${name}/result.bin`)
    ).rejects.toThrow()
  }
  expect(await readFile(source)).toEqual(bytes)
})
