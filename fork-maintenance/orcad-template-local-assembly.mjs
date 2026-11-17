// Builds the SSH host server template without CI: this fork's server code, built on this machine,
// plus the per-OS native binaries (node-pty, watcher, ripgrep, Windows helpers) of an upstream release.
// Those binaries carry no fork features; a version check refuses a release whose natives differ.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Native packages whose JS loader ships from the fork while their binaries ship from the release.
const NATIVE_PACKAGES = ['node_modules/node-pty/', 'node_modules/@parcel/watcher/']
const RELEASE_RESOURCES = 'Orca.app/Contents/Resources'

function run(program, args, options) {
  const result = spawnSync(program, args, {
    stdio: 'inherit',
    // pnpm is a .cmd shim on Windows, which spawn only finds through a shell.
    shell: process.platform === 'win32' && program === 'pnpm',
    ...options
  })
  if (result.error || result.status !== 0) {
    throw new Error(
      `${program} ${args.join(' ')} failed${result.error ? `: ${result.error.message}` : ''}`
    )
  }
}

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const at = (base, filename) => join(base, ...filename.split('/'))

function extractReleaseResources(repo, tag, work, say) {
  const asset = `Orca-${tag.replace(/^v/, '')}-arm64-mac.zip`
  say(`Downloading ${asset} from ${repo} for its native binaries…`)
  run('gh', ['release', 'download', tag, '--repo', repo, '--pattern', asset, '--dir', work])
  const members = [`${RELEASE_RESOURCES}/orcad-template/*`, `${RELEASE_RESOURCES}/ripgrep/*`]
  // Windows has no unzip; its bundled bsdtar reads zip archives.
  if (process.platform === 'win32') {
    run('tar', ['-xf', join(work, asset), '-C', work, ...members.map((m) => m.slice(0, -2))])
  } else {
    run('unzip', ['-q', join(work, asset), ...members, '-d', work])
  }
  return join(work, ...RELEASE_RESOURCES.split('/'))
}

/** The release's binaries fit only the exact loader JS they shipped with. */
function assertSameNatives(forkPackage, releaseTemplate, commonFilenames, tag) {
  const loaders = commonFilenames.filter((f) => NATIVE_PACKAGES.some((dir) => f.startsWith(dir)))
  const differing = loaders.filter(
    (f) =>
      !existsSync(at(releaseTemplate, f)) ||
      sha256(at(forkPackage, f)) !== sha256(at(releaseTemplate, f))
  )
  if (loaders.length === 0 || differing.length > 0) {
    throw new Error(
      `${tag}'s native binaries don't match this checkout (${differing.join(', ') || 'no loaders found'}); ` +
        'pass --tag with the upstream release closest to your last upstream merge'
    )
  }
}

/** Releases share one ripgrep with the app; restore each target's own copy so the template stands alone. */
function unshareRipgrep(templateDir, releaseResources, targetsDir, orcadRipgrepArtifact) {
  const manifestPath = join(templateDir, 'orcad-template.json')
  const manifest = readJson(manifestPath)
  for (const [target, entry] of Object.entries(manifest.targets)) {
    if (entry.packagedRipgrep) {
      const filename = orcadRipgrepArtifact(target)
      const destination = at(join(templateDir, targetsDir, target), filename)
      mkdirSync(dirname(destination), { recursive: true })
      copyFileSync(at(releaseResources, filename), destination)
      chmodSync(destination, 0o755)
      if (sha256(destination) !== entry.files[filename]) {
        throw new Error(`${target} ripgrep in the release differs from its template manifest`)
      }
      delete entry.packagedRipgrep
    }
    // The release's darwin browser carries its signer's hash; packaging references this app's copy.
    delete entry.browserName
    delete entry.browserSha256
    delete entry.packagedBrowser
  }
  return manifest.targets
}

export async function assembleLocalTemplate({ repoRoot, outputDir, upstreamRepo, tag, say }) {
  const imports = (path) => import(pathToFileURL(join(repoRoot, path)).href)
  const {
    orcadTemplateCommonFilenames,
    orcadRipgrepArtifact,
    ORCAD_TEMPLATE_MANIFEST_FILENAME,
    ORCAD_TEMPLATE_TARGETS_DIR
  } = await imports('src/shared/orcad-artifacts.ts')
  const { readOrcadMobileWebAssetFilenames } = await imports(
    'config/scripts/orcad-distribution/server-bundle/orcad-mobile-web-bundle.mjs'
  )
  const work = mkdtempSync(join(tmpdir(), 'orcad-template-'))
  try {
    const releaseResources = extractReleaseResources(upstreamRepo, tag, work, say)
    const releaseTemplate = join(releaseResources, 'orcad-template')
    if (!existsSync(join(releaseTemplate, ORCAD_TEMPLATE_MANIFEST_FILENAME))) {
      throw new Error(`${tag} ships no server template`)
    }

    say("Building this fork's server code for this machine…")
    run('pnpm', ['run', 'build:packages'], { cwd: repoRoot })
    const forkPackage = join(work, 'fork-orcad')
    run(
      process.execPath,
      [
        join(repoRoot, 'config/scripts/orcad-distribution/prebuilds/build-orcad-node.mjs'),
        '--out-dir',
        forkPackage
      ],
      { cwd: repoRoot, env: { ...process.env, ORCAD_OMIT_AGENT_BROWSER: '1' } }
    )
    const commonFilenames = orcadTemplateCommonFilenames(
      readOrcadMobileWebAssetFilenames(forkPackage)
    )
    assertSameNatives(forkPackage, releaseTemplate, commonFilenames, tag)

    rmSync(outputDir, { recursive: true, force: true })
    mkdirSync(outputDir, { recursive: true })
    const commonSha256 = {}
    for (const filename of commonFilenames) {
      const destination = at(outputDir, filename)
      mkdirSync(dirname(destination), { recursive: true })
      copyFileSync(at(forkPackage, filename), destination)
      chmodSync(destination, statSync(at(forkPackage, filename)).mode)
      commonSha256[filename] = sha256(destination)
    }
    cpSync(
      join(releaseTemplate, ORCAD_TEMPLATE_TARGETS_DIR),
      join(outputDir, ORCAD_TEMPLATE_TARGETS_DIR),
      {
        recursive: true
      }
    )
    const releaseManifest = readJson(join(releaseTemplate, ORCAD_TEMPLATE_MANIFEST_FILENAME))
    writeFileSync(
      join(outputDir, ORCAD_TEMPLATE_MANIFEST_FILENAME),
      JSON.stringify(releaseManifest)
    )
    const targets = unshareRipgrep(
      outputDir,
      releaseResources,
      ORCAD_TEMPLATE_TARGETS_DIR,
      orcadRipgrepArtifact
    )
    writeFileSync(
      join(outputDir, ORCAD_TEMPLATE_MANIFEST_FILENAME),
      `${JSON.stringify({ schemaVersion: 3, commonSha256, targets }, null, 2)}\n`
    )
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}
