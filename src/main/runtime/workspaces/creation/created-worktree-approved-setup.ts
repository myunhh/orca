import { isFolderRepo } from '../../../../shared/repo-kind'
import { getRepoExecutionHostId, isRepoOnCatalogHost } from '../../../../shared/execution-host'
import { scopeHooksToRepoKind } from '../../../../shared/folder-workspace-hooks'
import { getSetupRunnerCommandPlatformForPath } from '../../../../shared/agent-launch/startup/setup-runner-command'
import type {
  CreateWorktreeResult,
  RunApprovedWorktreeSetupResult
} from '../../../../shared/worktree/create-types'
import {
  getDefaultTabsLaunch,
  getEffectiveHooksFromConfig
} from '../../../workspace-hooks/effective-hook-config'
import { loadHooks } from '../../../workspace-hooks/hooks'
import {
  checkCreatedWorktreeSetupTrust,
  defaultTabsWithCommands
} from '../../../workspace-hooks/created-worktree-setup-trust'
import {
  createSetupRunnerScript,
  resolveSetupRunnerShell
} from '../../../workspace-hooks/worktree-runner-script'
import { getLocalProjectWorktreeGitOptions } from '../../../workspaces/execution-host/project-runtime-git-options'
import type { Worktree } from '../../../../shared/worktree/types'
import type { RuntimeStore } from '../../construction/runtime-store-contract'
import type { WorktreeTerminalProvisioningArgs } from '../startup/runtime-worktree-terminal-provisioning'
import { requireWorktreeCreateRoute } from '../../../workspaces/creation/worktree-create-execution-host-route'
import { requireSshGitProvider } from '../../../providers/ssh-git-dispatch'
import { requireSshFilesystemProvider } from '../../../providers/ssh-filesystem-dispatch'
import { prepareRuntimeSshWorktreeSetup } from './runtime-ssh-worktree-setup'

type ApprovedSetupRuntime = {
  showManagedWorktree: (
    selector: string
  ) => Promise<Pick<Worktree, 'id' | 'repoId' | 'path' | 'displayName' | 'hostId'>>
  requireStore: () => Pick<RuntimeStore, 'getRepo' | 'getSettings'>
  provisionManagedWorktreeTerminals: (args: WorktreeTerminalProvisioningArgs) => Promise<unknown>
}

/**
 * Start setup and default-tab commands a create skipped, once the user approved this worktree's
 * own content. Re-hashes first, so only the approved bytes run.
 */
export async function runApprovedCreatedWorktreeSetup(
  runtime: ApprovedSetupRuntime,
  worktreeSelector: string,
  approvedSetupHash: string,
  options: { wslUserAct?: true } = {}
): Promise<RunApprovedWorktreeSetupResult> {
  const worktree = await runtime.showManagedWorktree(worktreeSelector)
  const store = runtime.requireStore()
  const repo = store.getRepo(worktree.repoId)
  if (!repo || (isFolderRepo(repo) && !isRepoOnCatalogHost(repo))) {
    return { status: 'not_configured' }
  }
  if (worktree.hostId && worktree.hostId !== getRepoExecutionHostId(repo)) {
    throw new Error(
      'Workspace setup ownership changed. Refresh the workspace before approving setup.'
    )
  }
  const route = requireWorktreeCreateRoute(repo)
  let setup: CreateWorktreeResult['setup']
  let defaultTabs: CreateWorktreeResult['defaultTabs']
  if (route.kind === 'ssh') {
    const prepared = await prepareRuntimeSshWorktreeSetup({
      request: {
        repoSelector: { selector: `id:${repo.id}`, hostId: route.hostId },
        name: worktree.displayName ?? repo.displayName,
        setupDecision: 'run',
        approvedSetupHash
      },
      repo,
      worktreePath: worktree.path,
      provider: requireSshGitProvider(route.connectionId),
      fs: requireSshFilesystemProvider(route.connectionId)
    })
    if (prepared.setupTrustMismatch) {
      return { status: 'mismatch', setupTrustMismatch: prepared.setupTrustMismatch }
    }
    setup = prepared.setup
    defaultTabs = defaultTabsWithCommands(prepared.defaultTabs)
  } else {
    const yamlHooks = scopeHooksToRepoKind(repo, loadHooks(worktree.path))
    const mismatch = checkCreatedWorktreeSetupTrust(repo, yamlHooks, 'run', { approvedSetupHash })
    if (mismatch) {
      return { status: 'mismatch', setupTrustMismatch: mismatch }
    }
    const setupScript = getEffectiveHooksFromConfig(repo, yamlHooks)?.scripts.setup
    setup = setupScript
      ? await createSetupRunnerScript(
          repo,
          worktree.path,
          setupScript,
          getLocalProjectWorktreeGitOptions(store, repo),
          resolveSetupRunnerShell(store.getSettings()),
          yamlHooks?.setupAgentStartupPolicy,
          { worktreeId: worktree.id, displayName: worktree.displayName }
        )
      : undefined
    // The create already opened the command-less default tabs.
    defaultTabs = defaultTabsWithCommands(getDefaultTabsLaunch(yamlHooks, repo, 'run'))
  }
  if (!setup && !defaultTabs) {
    return { status: 'not_configured' }
  }
  await runtime.provisionManagedWorktreeTerminals({
    worktreeSelector: `id:${worktree.id}`,
    worktreeId: worktree.id,
    worktreePath: worktree.path,
    ...(setup ? { setup } : {}),
    ...(defaultTabs ? { defaultTabs } : {}),
    hasStartupTerminal: true,
    setupCommandPlatform: getSetupRunnerCommandPlatformForPath(
      setup?.runnerScriptPath ?? '',
      process.platform === 'win32' ? 'windows' : 'posix'
    ),
    ...options
  })
  return { status: 'started' }
}
