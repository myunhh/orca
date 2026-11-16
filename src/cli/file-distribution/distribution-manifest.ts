import { readFile, realpath, lstat, readdir } from 'node:fs/promises'
import { dirname, resolve, relative, isAbsolute, sep } from 'node:path'
import { z } from 'zod'
import { parseExecutionHostId } from '../../shared/execution-host'

export const DistributionPath = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.includes('\\') &&
      !value.includes(':') &&
      !value.includes('\0') &&
      !value.startsWith('/') &&
      value.split('/').every((part) => part !== '' && part !== '.' && part !== '..'),
    'Use a relative path with / separators, without . or .. components'
  )

const TargetFields = {
  name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
  worktree: z.string().regex(/^(id:|folder:).+/, 'Use an exact id: or folder: workspace selector'),
  directory: DistributionPath
}
const SshHostId = z.string().transform((value, context) => {
  const host = parseExecutionHostId(value)
  if (host?.kind === 'ssh') {
    return host.id
  }
  context.addIssue({
    code: 'custom',
    message: 'Direct targets require an explicit ssh: executionHostId'
  })
  return z.NEVER
})
const Target = z.union([
  z.object({ ...TargetFields, environment: z.string().min(1) }).strict(),
  z.object({ ...TargetFields, executionHostId: SshHostId }).strict()
])

const Manifest = z
  .object({
    source: z.string().min(1),
    inputs: z.array(DistributionPath).min(1),
    results: z.array(DistributionPath).min(1),
    targets: z.array(Target).min(1)
  })
  .strict()
  .superRefine((value, context) => {
    const names = new Set<string>()
    for (const target of value.targets) {
      const name = target.name.toLowerCase()
      if (names.has(name)) {
        context.addIssue({ code: 'custom', message: `Duplicate target name: ${target.name}` })
      }
      names.add(name)
    }
  })

export type DistributionTarget = z.infer<typeof Target>
export type DistributionManifest = z.infer<typeof Manifest>

export async function readDistributionManifest(path: string): Promise<DistributionManifest> {
  const manifest = Manifest.parse(JSON.parse(await readFile(path, 'utf8')))
  return { ...manifest, source: resolve(dirname(path), manifest.source) }
}

export async function localDistributionFiles(
  root: string,
  paths: readonly string[]
): Promise<string[]> {
  const canonicalRoot = await realpath(root)
  const files = new Set<string>()
  async function visit(path: string): Promise<void> {
    DistributionPath.parse(path)
    const absolute = resolve(canonicalRoot, path)
    const canonical = await realpath(absolute)
    const inside = relative(canonicalRoot, canonical)
    if (isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`)) {
      throw new Error(`Source path leaves the distribution root: ${path}`)
    }
    const stat = await lstat(absolute)
    if (stat.isSymbolicLink()) {
      throw new Error(`Symbolic links are not distributed: ${path}`)
    }
    if (stat.isDirectory()) {
      for (const entry of await readdir(absolute)) {
        await visit(`${path}/${entry}`)
      }
    } else if (stat.isFile()) {
      files.add(path)
    } else {
      throw new Error(`Not a regular source file: ${path}`)
    }
  }
  for (const path of paths) {
    await visit(path)
  }
  return [...files].sort()
}
