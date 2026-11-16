import {
  textGenerationFailure,
  textGenerationFailureCodeFields
} from '../../../shared/text-generation-failure-copy'
import { ipcMain } from 'electron'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import type { ResolvedSourceControlAiGenerationParams } from '../../../shared/source-control/ai/source-control-ai-operation-resolution'
import type { HostedReviewProvider } from '../../../shared/source-control/hosted-review/hosted-review-contracts'
import type { PullRequestDraftContext } from '../../../shared/source-control/ai/generation/pull-request-generation'
import {
  cancelGeneratePullRequestFieldsLocal,
  generatePullRequestFieldsFromContext,
  resolveCommitMessageSettings,
  type GeneratePullRequestFieldsResult
} from '../../text-generation/commit-message-text-generation'
import { getCommitMessageModelDiscoveryHostKey } from '../../../shared/source-control/ai/generation/commit-message-host-key'
import { getPullRequestDraftContext } from '../../text-generation/pull-request-context'
import { prepareLocalCommitMessageAgentEnv } from '../../text-generation/commit-message-agent-environment'
import { requireSshGitProvider } from '../../providers/ssh-git-dispatch'
import { resolveRegisteredWorktreePath } from '../worktrees/removal/registered-worktree-roots-cache'
import { getLocalGitOptionsForRegisteredWorktree } from '../local-worktree-runtime-options'
import { gitExecFileAsync } from '../../git/command-runner/git-exec-file'
import { withLinkedIssueDraftContext } from '../../../shared/source-control/ai/recipes/source-control-ai-action-variables'
import { resolveSourceControlAiLinkedIssueMeta } from '../source-control/source-control-ai-linked-issue'
import { resolveHostedReviewBodyForGeneration } from '../../source-control/pull-request-template'
import { loadPullRequestLinkedIssue } from '../../source-control/pull-request-linked-issue'
import type { FilesystemHandlerContext } from './filesystem-handler-context'
import {
  getLocalAgentRuntimeTarget,
  getLocalTextGenerationTarget,
  getRepoForSourceControlAi
} from './filesystem-source-control-ai-targets'

export function registerFilesystemGitPullRequestGenerationHandlers(
  context: FilesystemHandlerContext
): void {
  const { store, commitMessageAgentEnv } = context
  ipcMain.handle(
    'git:generatePullRequestFields',
    async (
      _event,
      args: {
        worktreePath: string
        // Raw (unstripped) meta key; validated against worktreePath before any meta read.
        worktreeId?: string
        repoId?: string
        base: string
        title: string
        body: string
        draft: boolean
        provider?: HostedReviewProvider
        useTemplate?: boolean
        connectionId?: string
        sourceControlAiResolvedParams?: ResolvedSourceControlAiGenerationParams
        sourceControlAi?: GlobalSettings['sourceControlAi']
        agentCmdOverrides?: GlobalSettings['agentCmdOverrides']
      }
    ): Promise<GeneratePullRequestFieldsResult> => {
      const discoveryHostKey = getCommitMessageModelDiscoveryHostKey(args.connectionId ?? null)
      const baseSettings = store.getSettings()
      const requestSettings = {
        ...baseSettings,
        ...(args.sourceControlAi !== undefined ? { sourceControlAi: args.sourceControlAi } : {}),
        ...(args.agentCmdOverrides !== undefined
          ? { agentCmdOverrides: args.agentCmdOverrides }
          : {})
      }
      const resolvedSettings = args.sourceControlAiResolvedParams
        ? { ok: true as const, params: args.sourceControlAiResolvedParams }
        : resolveCommitMessageSettings(
            requestSettings,
            discoveryHostKey,
            'pullRequest',
            await getRepoForSourceControlAi(store, args)
          )
      if (!resolvedSettings.ok) {
        return {
          success: false,
          error: resolvedSettings.error,
          ...textGenerationFailureCodeFields(resolvedSettings)
        }
      }
      if (args.connectionId) {
        const provider = requireSshGitProvider(args.connectionId)
        const issueMeta = resolveSourceControlAiLinkedIssueMeta(store, args)
        const linkedIssueDetailsPromise = loadPullRequestLinkedIssue({
          meta: issueMeta,
          provider: args.provider,
          repoPath: args.worktreePath,
          connectionId: args.connectionId
        })
        void linkedIssueDetailsPromise.catch(() => undefined)
        let context: PullRequestDraftContext | null
        try {
          const currentBody = await resolveHostedReviewBodyForGeneration({
            body: args.body,
            repoPath: args.worktreePath,
            connectionId: args.connectionId,
            provider: args.provider,
            useTemplate: args.useTemplate
          })
          context = await getPullRequestDraftContext(
            (argv, options) =>
              provider.exec(
                argv,
                args.worktreePath,
                options?.timeoutMs === undefined && options?.timeout === undefined
                  ? {}
                  : { timeoutMs: options?.timeoutMs ?? options?.timeout }
              ),
            {
              base: args.base,
              currentTitle: args.title,
              currentBody,
              currentDraft: args.draft
            }
          )
        } catch (error) {
          return {
            success: false,
            error:
              error instanceof Error ? error.message : 'Failed to prepare branch for PR details.'
          }
        }
        if (!context) {
          return { success: false, ...textGenerationFailure('noBranchChanges') }
        }
        const linkedIssueDetails = await linkedIssueDetailsPromise
        context = {
          ...withLinkedIssueDraftContext(context, issueMeta?.linkedIssue),
          ...(args.provider ? { provider: args.provider } : {}),
          ...(linkedIssueDetails ? { linkedIssueDetails } : {})
        }
        return generatePullRequestFieldsFromContext(context, resolvedSettings.params, {
          kind: 'remote',
          cwd: args.worktreePath,
          execute: (plan, cwd, timeoutMs, operation) =>
            provider.executeCommitMessagePlan(plan, cwd, timeoutMs, operation),
          missingBinaryLocation: 'remote PATH'
        })
      }

      const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
      const gitOptions = getLocalGitOptionsForRegisteredWorktree(
        store,
        args.worktreePath,
        worktreePath
      )
      const issueMeta = resolveSourceControlAiLinkedIssueMeta(store, args, worktreePath)
      const linkedIssueDetailsPromise = loadPullRequestLinkedIssue({
        meta: issueMeta,
        provider: args.provider,
        repoPath: worktreePath,
        localGitOptions: gitOptions
      })
      // Preparation can return before this lookup settles; retain its error for the later await.
      void linkedIssueDetailsPromise.catch(() => undefined)
      let context: PullRequestDraftContext | null
      try {
        const currentBody = await resolveHostedReviewBodyForGeneration({
          body: args.body,
          repoPath: worktreePath,
          provider: args.provider,
          useTemplate: args.useTemplate
        })
        context = await getPullRequestDraftContext(
          (argv, options) =>
            gitExecFileAsync(argv, {
              cwd: worktreePath,
              ...gitOptions,
              ...(options?.maxBuffer === undefined ? {} : { maxBuffer: options.maxBuffer }),
              ...(options?.timeoutMs === undefined && options?.timeout === undefined
                ? {}
                : { timeout: options?.timeoutMs ?? options?.timeout })
            }),
          {
            base: args.base,
            currentTitle: args.title,
            currentBody,
            currentDraft: args.draft
          }
        )
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to prepare branch for PR details.'
        }
      }
      if (!context) {
        return { success: false, ...textGenerationFailure('noBranchChanges') }
      }
      const linkedIssueDetails = await linkedIssueDetailsPromise
      context = {
        ...withLinkedIssueDraftContext(context, issueMeta?.linkedIssue),
        ...(args.provider ? { provider: args.provider } : {}),
        ...(linkedIssueDetails ? { linkedIssueDetails } : {})
      }
      const localEnv = await prepareLocalCommitMessageAgentEnv(
        resolvedSettings.params.agentId,
        commitMessageAgentEnv,
        getLocalAgentRuntimeTarget(gitOptions)
      )
      if (!localEnv.ok) {
        return { success: false, error: localEnv.error }
      }
      return generatePullRequestFieldsFromContext(
        context,
        resolvedSettings.params,
        getLocalTextGenerationTarget(worktreePath, gitOptions, localEnv.env)
      )
    }
  )

  ipcMain.handle(
    'git:cancelGeneratePullRequestFields',
    async (_event, args: { worktreePath: string; connectionId?: string }): Promise<void> => {
      if (args.connectionId) {
        await requireSshGitProvider(args.connectionId).cancelGenerateCommitMessage(
          args.worktreePath,
          'pull-request-fields'
        )
        return
      }
      const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
      cancelGeneratePullRequestFieldsLocal(worktreePath)
    }
  )
}
