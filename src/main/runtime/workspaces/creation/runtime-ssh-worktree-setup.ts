import { posix, win32 } from 'node:path'
import { parseOrcaYaml } from '../../../../shared/orca-yaml'
import { isWindowsAbsolutePathLike } from '../../../../shared/cross-platform-path'
import { shouldWaitForSetupBeforeAgentStartup } from '../../../../shared/agent-launch/startup/setup-agent-startup-policy'
import type { Repo } from '../../../../shared/repo-types'
import type { IFilesystemProvider } from '../../../providers/filesystem-provider-contract'
import type { SshGitProvider } from '../../../providers/ssh-git-provider'
import { isENOENT } from '../../../ipc/filesystem/access/filesystem-path-containment'
import { joinWorktreeRelativePath } from '../../files/paths/runtime-relative-paths'
import {
  getDefaultTabsLaunch,
  getEffectiveHooksFromConfig,
  shouldRunSetupForCreate
} from '../../../workspace-hooks/effective-hook-config'
import {
  checkCreatedWorktreeSetupTrust,
  defaultTabsWithoutCommands
} from '../../../workspace-hooks/created-worktree-setup-trust'
import {
  buildPosixRunnerScript,
  buildWindowsRunnerScript
} from '../../../workspace-hooks/setup-runner-script-text'
import { getSetupRunnerEnvVars } from '../../../workspace-hooks/setup-hook-env-vars'
import {
  resolveRuntimeSetupDecision,
  type RuntimePreparedWorktreeSetup
} from './runtime-local-worktree-setup'
import type { RuntimeManagedWorktreeCreateArgs } from './runtime-managed-worktree-create-types'

export async function readSshWorktreeHooks(fs: IFilesystemProvider, path: string) {
  try {
    const result = await fs.readFile(joinWorktreeRelativePath(path, 'orca.yaml'))
    if (result.isBinary) {
      throw new Error('Remote orca.yaml is not a text file')
    }
    return parseOrcaYaml(result.content)
  } catch (error) {
    if (isENOENT(error)) {
      return null
    }
    throw error
  }
}

export async function prepareRuntimeSshWorktreeSetup(args: {
  request: RuntimeManagedWorktreeCreateArgs
  repo: Repo
  worktreePath: string
  provider: SshGitProvider
  fs: IFilesystemProvider
  warning?: string
}): Promise<RuntimePreparedWorktreeSetup> {
  const { request, repo, worktreePath, provider, fs } = args
  const yaml = await readSshWorktreeHooks(fs, worktreePath)
  const hooks = getEffectiveHooksFromConfig(repo, yaml)
  const effectiveDecision = resolveRuntimeSetupDecision(request)
  const setupTrustMismatch = checkCreatedWorktreeSetupTrust(repo, yaml, effectiveDecision, request)
  const decision = setupTrustMismatch ? 'skip' : effectiveDecision
  let defaultTabs: RuntimePreparedWorktreeSetup['defaultTabs']
  try {
    const launch = getDefaultTabsLaunch(yaml, repo, decision)
    defaultTabs = setupTrustMismatch ? defaultTabsWithoutCommands(launch) : launch
  } catch (error) {
    console.warn(`[hooks] remote default tab commands skipped for ${worktreePath}:`, error)
    defaultTabs = yaml?.defaultTabs ? { tabs: yaml.defaultTabs, runCommands: false } : undefined
  }
  let shouldRunSetup = false
  let setup: RuntimePreparedWorktreeSetup['setup']
  if (hooks?.scripts.setup) {
    try {
      shouldRunSetup = shouldRunSetupForCreate(repo, decision)
    } catch {
      // A newly checked-out branch may introduce an unapproved setup hook.
    }
  }
  let warning = args.warning
  if (shouldRunSetup && hooks?.scripts.setup) {
    try {
      const windows = isWindowsAbsolutePathLike(worktreePath)
      const relative = windows ? 'orca/setup-runner.cmd' : 'orca/setup-runner.sh'
      const { stdout } = await provider.exec(['rev-parse', '--git-path', relative], worktreePath)
      const pathOps = windows ? win32 : posix
      const runnerScriptPath = pathOps.resolve(worktreePath, stdout.trim())
      await fs.createDir(pathOps.dirname(runnerScriptPath))
      await fs.writeFile(
        runnerScriptPath,
        windows
          ? buildWindowsRunnerScript(hooks.scripts.setup)
          : buildPosixRunnerScript(hooks.scripts.setup)
      )
      setup = {
        runnerScriptPath,
        envVars: getSetupRunnerEnvVars(repo, worktreePath, {
          worktreeId: `${repo.id}::${worktreePath}`
        }),
        ...(shouldWaitForSetupBeforeAgentStartup(
          repo.hookSettings?.setupAgentStartupPolicy,
          yaml?.setupAgentStartupPolicy
        )
          ? { waitForAgentStartup: true }
          : {})
      }
    } catch (error) {
      const failure = `Setup did not run: Orca could not prepare its remote runner in ${worktreePath}.`
      warning = warning ? `${warning} ${failure}` : failure
      console.error('[hooks] remote setup runner preparation failed:', error)
    }
  }
  return {
    ...(setup ? { setup } : {}),
    ...(defaultTabs ? { defaultTabs } : {}),
    ...(warning ? { warning } : {}),
    ...(setupTrustMismatch ? { setupTrustMismatch } : {}),
    effectiveDecision,
    hookFound: Boolean(hooks?.scripts.setup),
    shouldRunSetup,
    didStartInProcessSetupHook: false
  }
}
