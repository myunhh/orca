// Brings upstream stablyai/orca changes into this fork without losing the fork's added features.
// Usage: node fork-maintenance/sync-with-upstream.mjs [--skip-checks]
import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const UPSTREAM_URL = 'https://github.com/stablyai/orca.git'
const UPSTREAM_BRANCH = 'main'
const LOCALE_GLOB = 'src/renderer/src/i18n/locales/*.json'
const MERGE_DRIVER_NAME = 'orca-locale-json'
// Generated from sources, so a conflict is settled by taking upstream's file and regenerating.
const GENERATED_FILES = [
  'src/renderer/src/i18n/en-runtime-required.json',
  'src/shared/plugins/languages/protected-copy-keys.json'
]
const REGENERATE_COMMANDS = [
  ['config/scripts/localization/catalog-validation/verify-localization-catalog.mjs', '--fix'],
  [
    'config/scripts/localization/catalog-validation/generate-runtime-required-english-catalog.mjs',
    '--fix'
  ],
  ['config/scripts/localization/catalog-validation/protected-copy-keys.mjs', '--fix']
]
const TYPECHECK_PROJECTS = ['config/tsconfig.node.json', 'config/tsconfig.tc.web.json']

const skipChecks = process.argv.includes('--skip-checks')
const scriptDir = import.meta.dirname
const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: scriptDir,
  encoding: 'utf8'
}).trim()

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: 'utf8', ...options })
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}
const git = (...args) => run('git', args)
const gitOrThrow = (...args) => {
  const result = git(...args)
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed:\n${result.stderr || result.stdout}`)
  }
  return result.stdout.trim()
}
const say = (message) => console.log(`[sync] ${message}`)

function installLocaleMergeDriver() {
  const driver = `node "${resolve(scriptDir, 'merge-locale-json.mjs')}" %O %A %B`
  gitOrThrow('config', `merge.${MERGE_DRIVER_NAME}.name`, 'Merge locale catalogs key by key')
  gitOrThrow('config', `merge.${MERGE_DRIVER_NAME}.driver`, driver)
  gitOrThrow('config', 'rerere.enabled', 'true')
  const attributesPath = resolve(repoRoot, gitOrThrow('rev-parse', '--git-path', 'info/attributes'))
  const line = `${LOCALE_GLOB} merge=${MERGE_DRIVER_NAME}`
  const current = existsSync(attributesPath) ? readFileSync(attributesPath, 'utf8') : ''
  if (!current.split('\n').includes(line)) {
    appendFileSync(attributesPath, `${current && !current.endsWith('\n') ? '\n' : ''}${line}\n`)
  }
}

function unmergedFiles() {
  return gitOrThrow('diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean)
}

const changedTrackedFiles = () =>
  git('diff', '--name-only', 'HEAD').stdout.split('\n').filter(Boolean)

function regenerateCatalogs() {
  const dirtyBefore = new Set(changedTrackedFiles())
  for (const [script, ...args] of REGENERATE_COMMANDS) {
    if (!existsSync(resolve(repoRoot, script))) {
      say(`skipping ${script}: not present in this upstream version`)
      continue
    }
    const result = run(process.execPath, [script, ...args])
    if (result.status !== 0) {
      say(`${script} failed:\n${result.stderr || result.stdout}`)
    }
  }
  // Only what regeneration touched: the person finishing a merge may have unrelated edits open.
  const regenerated = changedTrackedFiles().filter((file) => !dirtyBefore.has(file))
  if (regenerated.length > 0) {
    gitOrThrow(
      'commit',
      '-q',
      '-m',
      'Regenerate localization catalogs after upstream sync',
      '--',
      ...regenerated
    )
    say(`regenerated localization catalogs and committed ${regenerated.length} file(s)`)
  }
}

function typecheck() {
  let failed = false
  for (const project of TYPECHECK_PROJECTS) {
    const result = run(process.execPath, [
      'config/scripts/typecheck/project-execution/run-typecheck-projects-in-parallel.mjs',
      `--project=${project}`
    ])
    const errors = `${result.stdout}\n${result.stderr}`
      .split('\n')
      .filter((line) => line.includes('error TS'))
    say(`${project}: ${errors.length === 0 ? 'ok' : `${errors.length} error(s)`}`)
    if (errors.length > 0) {
      failed = true
      console.log(errors.slice(0, 15).join('\n'))
    }
  }
  return !failed
}

function mergeInProgress() {
  return git('rev-parse', '-q', '--verify', 'MERGE_HEAD').status === 0
}

function finishRemainingSteps(branch, upstreamRef) {
  say(`merged ${upstreamRef} into ${branch}`)
  regenerateCatalogs()
  if (!skipChecks && !typecheck()) {
    say('The merge is committed but does not typecheck; fix the errors above before building.')
    return 3
  }
  say('Done. Next: `pnpm install` (dependencies may have changed), then `pnpm dev` or rebuild.')
  say(`Then publish with: git push origin ${branch}`)
  return 0
}

function reportUnresolved(left) {
  say(`Merge stopped: ${left.length} file(s) need a manual decision:`)
  console.log(left.map((name) => `  ${name}`).join('\n'))
  say('Fix each file, `git add` it, then run this script again to finish the merge.')
  say('Git remembers your choices for next time. To give up instead: git merge --abort')
}

function main() {
  if (mergeInProgress()) {
    const left = unmergedFiles()
    if (left.length > 0) {
      reportUnresolved(left)
      return 2
    }
    gitOrThrow('commit', '--no-edit')
    return finishRemainingSteps(gitOrThrow('rev-parse', '--abbrev-ref', 'HEAD'), 'upstream')
  }
  if (git('status', '--porcelain', '--untracked-files=normal').stdout.trim()) {
    say('The working tree has uncommitted changes. Commit or stash them first.')
    return 1
  }
  const branch = gitOrThrow('rev-parse', '--abbrev-ref', 'HEAD')
  if (git('remote', 'get-url', 'upstream').status !== 0) {
    gitOrThrow('remote', 'add', 'upstream', UPSTREAM_URL)
    say(`added remote "upstream" -> ${UPSTREAM_URL}`)
  }
  gitOrThrow('fetch', 'upstream', UPSTREAM_BRANCH)
  const upstreamRef = `upstream/${UPSTREAM_BRANCH}`
  if (git('merge-base', '--is-ancestor', upstreamRef, 'HEAD').status === 0) {
    say(`Already up to date with ${upstreamRef}.`)
    return 0
  }
  installLocaleMergeDriver()
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  const backupTag = `pre-upstream-sync-${stamp}`
  gitOrThrow('tag', backupTag)
  say(`backup tag ${backupTag} (undo with: git reset --hard ${backupTag})`)

  const merge = git('merge', upstreamRef, '-m', `Merge upstream ${UPSTREAM_URL} ${UPSTREAM_BRANCH}`)
  if (merge.status !== 0) {
    for (const file of unmergedFiles().filter((name) => GENERATED_FILES.includes(name))) {
      gitOrThrow('checkout', '--theirs', '--', file)
      gitOrThrow('add', '--', file)
    }
    const left = unmergedFiles()
    if (left.length > 0) {
      reportUnresolved(left)
      return 2
    }
    gitOrThrow('commit', '--no-edit')
  }
  return finishRemainingSteps(branch, upstreamRef)
}

process.exitCode = main()
