import { copyFile, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, posix, resolve } from 'node:path'
import type { CommandHandler, HandlerContext } from '../dispatch'
import { getOptionalStringFlag, getRequiredStringFlag } from '../flags'
import { RuntimeClient, RuntimeClientError } from '../runtime-client'
import {
  localDistributionFiles,
  readDistributionManifest,
  type DistributionTarget
} from '../file-distribution/distribution-manifest'
import {
  collectDistributionFile,
  remoteDistributionFiles,
  uploadDistributionFile
} from '../file-distribution/distribution-transfer'
import { z } from 'zod'
import { parseExecutionHostId } from '../../shared/execution-host'
import { FILE_EXECUTION_HOST_RUNTIME_CAPABILITY } from '../../shared/file-access/files-runtime-capabilities'
import type { RuntimeStatus } from '../../shared/runtime-types'
import type { DistributionEndpoint } from '../file-distribution/distribution-transfer'

type TargetOutcome = { target: string; files: string[]; completed: number; error?: string }

async function endpoint(
  ctx: HandlerContext,
  target: DistributionTarget
): Promise<DistributionEndpoint> {
  const client = new RuntimeClient(
    ctx.client.userDataPath,
    60_000,
    null,
    'environment' in target ? target.environment : null
  )
  if ('environment' in target) {
    return {
      client,
      scope: {
        worktree: target.worktree,
        executionHostId: 'local',
        expectedExecutionHostId: 'local'
      }
    }
  }
  const status = await client.call<RuntimeStatus>('status.get')
  if (!status.result.capabilities?.includes(FILE_EXECUTION_HOST_RUNTIME_CAPABILITY)) {
    throw new RuntimeClientError(
      'unsupported',
      'Update the desktop runtime before distributing files to a direct SSH target.'
    )
  }
  const host = parseExecutionHostId(target.executionHostId)
  if (host?.kind !== 'ssh') {
    throw new RuntimeClientError('invalid_argument', 'Expected a direct SSH target')
  }
  const response = await client.call('ssh.getState', { targetId: host.targetId })
  const { state } = z
    .object({
      state: z.object({
        targetId: z.literal(host.targetId),
        status: z.literal('connected'),
        connectionGeneration: z.number().int().nonnegative()
      })
    })
    .parse(response.result)
  return {
    client,
    scope: {
      worktree: target.worktree,
      executionHostId: host.id,
      expectedExecutionHostId: host.id,
      expectedSshTargetId: host.targetId,
      expectedSshConnectionGeneration: state.connectionGeneration
    }
  }
}

async function distribute(ctx: HandlerContext, direction: 'deploy' | 'collect'): Promise<void> {
  if (process.env.ORCA_CLI_CWD) {
    throw new RuntimeClientError(
      'invalid_environment',
      'Run file distribution on the local machine holding the manifest, not a forwarded SSH shell.'
    )
  }
  const manifest = await readDistributionManifest(
    resolve(ctx.cwd, getRequiredStringFlag(ctx.flags, 'manifest'))
  )
  const selected = getOptionalStringFlag(ctx.flags, 'target')
  const targets = selected
    ? manifest.targets.filter((target) => target.name === selected)
    : manifest.targets
  if (!targets.length) {
    throw new RuntimeClientError('invalid_argument', `Unknown distribution target: ${selected}`)
  }
  const apply = ctx.flags.get('apply') === true
  const overwrite = ctx.flags.get('overwrite') === true
  const output =
    direction === 'collect'
      ? resolve(ctx.cwd, getRequiredStringFlag(ctx.flags, 'output'))
      : undefined
  const files =
    direction === 'deploy' ? await localDistributionFiles(manifest.source, manifest.inputs) : []
  const outcomes: TargetOutcome[] = []
  let snapshot: string | undefined
  let collectionRoot: string | undefined
  try {
    if (apply && direction === 'deploy') {
      snapshot = await mkdtemp(join(tmpdir(), 'orca-distribution-'))
      for (const file of files) {
        const destination = join(snapshot, file)
        await mkdir(dirname(destination), { recursive: true })
        await copyFile(join(manifest.source, file), destination)
      }
    }
    if (apply && output) {
      await mkdir(dirname(output), { recursive: true })
      await mkdir(output)
      collectionRoot = await realpath(output)
    }
    for (const target of targets) {
      const outcome: TargetOutcome = { target: target.name, files: [], completed: 0 }
      outcomes.push(outcome)
      try {
        if (direction === 'deploy') {
          outcome.files = files.map((file) => posix.join(target.directory, file))
          if (!apply) {
            continue
          }
          if (!snapshot) {
            throw new Error('Deployment snapshot is unavailable')
          }
          const remote = await endpoint(ctx, target)
          for (const file of files) {
            await uploadDistributionFile(
              remote,
              join(snapshot, file),
              posix.join(target.directory, file),
              overwrite
            )
            outcome.completed++
          }
        } else {
          const remote = await endpoint(ctx, target)
          const results = await remoteDistributionFiles(
            remote,
            manifest.results.map((path) => posix.join(target.directory, path))
          )
          outcome.files = results
          if (!apply) {
            continue
          }
          if (!collectionRoot) {
            throw new Error('Collection directory is unavailable')
          }
          for (const source of results) {
            const path = posix.relative(target.directory, source)
            await collectDistributionFile(
              remote,
              source,
              collectionRoot,
              posix.join(target.name, path)
            )
            outcome.completed++
          }
        }
      } catch (error) {
        outcome.error = error instanceof Error ? error.message : String(error)
      }
    }
  } finally {
    if (snapshot) {
      await rm(snapshot, { recursive: true, force: true })
    }
  }
  const failed = outcomes.some((outcome) => outcome.error !== undefined)
  const result = { direction, applied: apply, overwrite, output, targets: outcomes }
  if (ctx.json) {
    console.log(JSON.stringify({ ok: !failed, result }, null, 2))
  } else {
    console.log(
      apply
        ? `${direction}: completed files are listed per target; the batch is not transactional.`
        : `${direction}: preview only; pass --apply to transfer files.`
    )
    for (const outcome of outcomes) {
      console.log(
        `${outcome.target}: ${outcome.completed}/${outcome.files.length} transferred${outcome.error ? `; ERROR: ${outcome.error}` : ''}`
      )
      for (const file of outcome.files) {
        console.log(`  ${file}`)
      }
    }
  }
  if (failed) {
    process.exitCode = 1
  }
}

export const FILE_DISTRIBUTION_HANDLERS: Record<string, CommandHandler> = {
  'file deploy': (ctx) => distribute(ctx, 'deploy'),
  'file collect': (ctx) => distribute(ctx, 'collect')
}
