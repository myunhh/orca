// Puts the SSH host server template into out/orcad-template so this fork's builds can set up SSH hosts.
// A full build needs node-pty built on every host OS, which only CI's runners do.
// Usage: node fork-maintenance/fetch-orcad-template.mjs [--local [--tag vX.Y.Z]] [--build] [--run <id>] [--repo owner/name]
//   --local  no CI: build this fork's server here and take per-OS natives from an upstream release
//   --build  start a fresh template build on this fork's GitHub Actions first, then download it
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { assembleLocalTemplate } from './orcad-template-local-assembly.mjs'

const WORKFLOW = 'node-server-tests.yml'
const ARTIFACT = 'orcad-template'

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: import.meta.dirname,
  encoding: 'utf8'
}).trim()
const outputDir = join(repoRoot, 'out', ARTIFACT)
const say = (message) => console.log(`[orcad-template] ${message}`)

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? null : (process.argv[index + 1] ?? null)
}

function gh(args, options = {}) {
  const result = spawnSync('gh', args, { cwd: repoRoot, encoding: 'utf8', ...options })
  if (result.error?.code === 'ENOENT') {
    throw new Error(
      'The GitHub CLI (gh) is required: https://cli.github.com, then `gh auth login`.'
    )
  }
  if (result.status !== 0) {
    throw new Error(`gh ${args.join(' ')} failed:\n${result.stderr || result.stdout}`)
  }
  return (result.stdout ?? '').trim()
}

const git = (...args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim()

const repo =
  argValue('--repo') ??
  // Why origin: with an `upstream` remote, a bare `gh repo view` resolves to upstream, not the fork.
  gh([
    'repo',
    'view',
    git('remote', 'get-url', 'origin'),
    '--json',
    'nameWithOwner',
    '-q',
    '.nameWithOwner'
  ])

function verifyOutput() {
  const require = createRequire(import.meta.url)
  const { verifyPackagedOrcadTemplate } = require(
    join(repoRoot, 'config/scripts/orcad-distribution/template/verify-packaged-orcad-template.cjs')
  )
  verifyPackagedOrcadTemplate(join(repoRoot, 'out'))
  if (!existsSync(outputDir)) {
    throw new Error(`${outputDir} is missing`)
  }
}

async function assembleLocally() {
  const upstreamRepo =
    argValue('--upstream') ??
    gh(['repo', 'view', repo, '--json', 'parent', '-q', '.parent | "\\(.owner.login)/\\(.name)"'])
  const tag =
    argValue('--tag') ??
    gh(['release', 'view', '--repo', upstreamRepo, '--json', 'tagName', '-q', '.tagName'])
  await assembleLocalTemplate({ repoRoot, outputDir, upstreamRepo, tag, say })
}

function hasLiveTemplateArtifact(runId) {
  const names = gh([
    'api',
    `repos/${repo}/actions/runs/${runId}/artifacts`,
    '-q',
    `.artifacts[] | select(.name == "${ARTIFACT}" and .expired == false) | .name`
  ])
  return names.split('\n').includes(ARTIFACT)
}

function latestTemplateRun() {
  const runs = JSON.parse(
    gh([
      'run',
      'list',
      '--repo',
      repo,
      '--workflow',
      WORKFLOW,
      '--status',
      'success',
      '--limit',
      '30',
      '--json',
      'databaseId,headSha,headBranch,createdAt'
    ])
  )
  return runs.find((run) => hasLiveTemplateArtifact(run.databaseId)) ?? null
}

function buildTemplate() {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
  say(`Starting a template build of ${branch} on ${repo} (about 30-60 minutes)…`)
  const startedAt = Date.now()
  gh([
    'workflow',
    'run',
    WORKFLOW,
    '--repo',
    repo,
    '--ref',
    branch,
    '-f',
    'build_template=true',
    // Blacksmith runners exist only on upstream's account.
    '-f',
    'fast_runners=false'
  ])
  let run = null
  for (let attempt = 0; attempt < 30 && !run; attempt += 1) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000)
    const runs = JSON.parse(
      gh([
        'run',
        'list',
        '--repo',
        repo,
        '--workflow',
        WORKFLOW,
        '--event',
        'workflow_dispatch',
        '--limit',
        '5',
        '--json',
        'databaseId,createdAt'
      ])
    )
    run = runs.find((candidate) => Date.parse(candidate.createdAt) >= startedAt - 60_000) ?? null
  }
  if (!run) {
    throw new Error('The template build did not start; check the Actions tab of your fork.')
  }
  say(`Watching run ${run.databaseId}…`)
  gh(['run', 'watch', String(run.databaseId), '--repo', repo, '--exit-status', '--compact'], {
    stdio: 'inherit'
  })
  return run.databaseId
}

async function main() {
  if (process.argv.includes('--local')) {
    await assembleLocally()
    verifyOutput()
    say(`Ready: ${outputDir}`)
    say('Restart `pnpm dev`, or rebuild the app, then reconnect the SSH host.')
    return
  }
  let runId = argValue('--run')
  if (!runId && process.argv.includes('--build')) {
    runId = String(buildTemplate())
  }
  if (!runId) {
    const run = latestTemplateRun()
    if (!run) {
      throw new Error(
        `No downloadable ${ARTIFACT} on ${repo} (artifacts expire after 7 days). Run again with --build.`
      )
    }
    runId = String(run.databaseId)
    const head = git('rev-parse', 'HEAD')
    if (run.headSha !== head) {
      say(
        `Note: run ${runId} built ${run.headSha.slice(0, 8)} (${run.headBranch}), not your HEAD ${head.slice(0, 8)}. ` +
          'Use --build if the server code changed since.'
      )
    }
  }
  rmSync(outputDir, { recursive: true, force: true })
  say(`Downloading ${ARTIFACT} from run ${runId}…`)
  gh(['run', 'download', runId, '--repo', repo, '--name', ARTIFACT, '--dir', outputDir], {
    stdio: 'inherit'
  })
  verifyOutput()
  say(`Ready: ${outputDir}`)
  say('Restart `pnpm dev`, or rebuild the app, then reconnect the SSH host.')
}

try {
  await main()
} catch (error) {
  console.error(`[orcad-template] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
