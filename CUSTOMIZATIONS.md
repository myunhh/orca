# Orca Customizations

This fork adds detached workbench windows, an agent graph, cross-terminal context sharing, local-account usage meters, multi-host file distribution, and a ChatGPT browser research workflow.

The original four customizations sit on top of upstream commit `aefcdd99` in the commit range `aefcdd99..76cda768`. That range does not include subsequent fixes, SSH restoration, file distribution, or the research workflow. To export the original changes:

```bash
git format-patch aefcdd99..76cda768 -o orca-customizations
```

## Keeping these features when Orca updates

Two things could otherwise remove the features: the app updating itself, and pulling new upstream code.

**Packaged builds do not self-update.** The updater is switched off in this fork's builds (`src/main/updater/self-update-policy.ts`), so an upstream release is never installed over your build. To get Orca's updater back, launch with `ORCA_ALLOW_UPSTREAM_UPDATES=1`. Running from source with `pnpm dev` never self-updates.

**Pulling upstream changes** is one command:

```bash
node fork-maintenance/sync-with-upstream.mjs
```

It adds the `upstream` remote on first use, tags a backup, merges `upstream/main`, regenerates the generated localization catalogs and typechecks. The locale files merge key by key, so new upstream text and this fork's text both stay. If upstream edited the same lines as this fork, the merge stops and lists the files: fix them, `git add` them, then run the command again to finish. Git remembers each resolution for next time.

- Undo a sync: `git reset --hard <backup tag printed by the script>`
- Skip the typecheck: add `--skip-checks`
- Afterwards run `pnpm install` and rebuild or restart `pnpm dev`

## CI cache warmup on forks

Forks warm only GitHub-hosted caches. The shared runtime, package-fixture and xterm cache matrices retain Blacksmith runners only for `stablyai/orca`, whose separate runner pool and cache store are provisioned upstream. macOS and Windows cache coverage is unchanged.

`Cancelled` does not necessarily mean a code failure: inspect the job annotations. A macOS job with no steps and “The job was not acquired by Runner” failed runner allocation; changing dependencies or switching architecture would not repair that capacity shortage.

See [the codebase dependency analysis](docs/codebase-dependency-analysis.md) for the graph artifacts, verified findings and remaining limitations.

## SSH hosts: relay and managed-server ownership

New manually added or imported SSH targets use the relay implementation restored from `dc08ffeba9603c5b48b9b100d0a7f89b021e6d1b` (2026-10-01), adapted to current authentication, host-key verification, workspace ownership, and terminal retirement rules. This changes Orca's remote execution path, not the system OpenSSH version.

Build the bundled relay when running from source:

```bash
pnpm build:relay
```

Existing managed-server targets and runtime-owned ephemeral VM targets retain their managed runtime route. Orca does not reclaim their catalogs or move/delete their data as part of relay restoration. Missing server templates can still affect those managed connections; fetch their template with:

```bash
node fork-maintenance/fetch-orcad-template.mjs --build
```

That command builds the managed template through your fork's GitHub Actions, requires `gh auth login`, and downloads it into `out/orcad-template`. Without `--build`, it downloads the newest available artifact. Refresh the template after upstream changes, then restart the app before reconnecting.

## 1. Detached Workbench Windows

Move terminals, Markdown files, images, and embedded Browser tabs into separate desktop windows.

- **Move to New Window**: right-click an eligible tab and choose **Move to New Window**.
- **Move to Window ▸**: send a tab to a workbench window that is already open.
- **Multiple tabs per window**: each workbench window has its own tab strip. You can switch tabs, close them, or open more.
  - **+** opens a new terminal in the workspace of the active tab.
  - **Add Existing Tab…** pulls in an eligible tab that is open in the main window.
- **Split View**: show two tabs side by side in the same window.
- **Split terminals**: split a terminal into panes inside a workbench window, the same as in the main window. Hover a pane and use its **Split Terminal Right** / **Split Terminal Down** buttons, or press the main window's split shortcuts while the pane is focused.
- **Return to Main Window**: send a tab back. Closing a workbench window returns all of its tabs to the main window, and their terminals keep running.
- **Live terminals**: terminals in a workbench window are fully interactive. The main window still owns every process and every saved layout, so no terminal is ever killed when it moves between windows.
- **Terminal sizing**: the detached window owns the visible terminal viewport. The main-window overlay no longer paints or resizes a detached tab.
- **Markdown images**: relative images are read through the source tab's filesystem owner and relayed as bytes. **Reload** refreshes the document and its image cache.
- **Browser sessions**: the original guest stays in the main window; the detached window streams its frames and forwards input. Moving or returning the tab does not create a new browser session.

**Limitations**

- Markdown and image tabs are read-only in a workbench window. Use **Reload** to pick up changes on disk.
- Browser workspaces containing workspace-document pages cannot detach. Their grant-bound document guests stay separate from website automation; open Markdown or images as editor tabs to use the read-only detached view.
- Agent tabs opened in the chat view cannot be detached. Agents running in a terminal can.
- Workbench windows are not restored after a restart. Their tabs reopen in the main window.
- Not available in paired web clients.

**Key files**

- Main process: `src/main/window/workbench-windows.ts`, `src/main/window/companion-window-chrome.ts`, `src/main/ipc/workbench-windows.ts`, `src/main/ipc/workbench-window-payload-validation.ts`, `src/main/ipc/companion-window-handlers.ts`
- Preload: `src/preload/api/workbench-windows-api.ts`, `src/preload/api/workbench-windows-bridge.ts`
- Window entry: `src/renderer/workbench.html`, `src/renderer/src/workbench.tsx`, `electron.vite.config.ts`
- Window UI: `src/renderer/src/components/workbench-window/`
- Main-window side: `src/renderer/src/components/workbench-window/bridge/`, `src/renderer/src/store/slices/workbench-window-ownership.ts`, `src/renderer/src/components/tab-bar/MoveTabToNewWindowMenuItem.tsx`, `src/renderer/src/components/tab-bar/MoveTabToWorkbenchWindowSubmenu.tsx`
- Shared types: `src/shared/workbench-window/workbench-window-types.ts`

## 2. Agent Graph

See which agents your main agent called, which model each one ran on, and what they said to each other.

- **Where**: the **Agent Graph** tab in the right sidebar, or **Show Agent Graph** in the right-click menu of a terminal or tab. By default the graph follows the active pane. You can also pick a pane.
- **Detected sub-agent calls**:
  - **Claude Code**: Agent/Task sub-agents and Workflow runs, including nested agents. Calls recorded in the main transcript appear even when the sub-agent's own transcript is missing.
  - **Codex**: sub-agent threads, found through the `parent_thread_id` each child records about itself. Prompts come from the parent's `spawn_agent` calls and follow-ups from its `send_input` calls.
  - **OMP**: sub-agent transcripts stored in the session's folder.
- **Nodes** show each agent's name, agent type, model, status and token count.
- **Edges** show the prompt sent (spawn), follow-up messages (message) and the returned answer (result).
- **Node details**: click a node to see the prompt it received, the result it returned and its transcript.
- The graph refreshes every 5 seconds while it is visible and is built in a background process.

**Limitations**

- Only sessions on the local machine are supported. Sessions on remote hosts, including SSH hosts, are not.

**Key files**

- Builders: `src/main/ai-vault/agent-graph/` (one file set each for Claude, Codex and OMP)
- IPC: `src/main/ipc/ai-vault/agent-graph-ipc.ts`, `agent-graph-build-requests.ts`, `agent-graph-transcript-admission.ts`
- Background process: `src/main/ai-vault/scan-service/` (graph client and `agentGraph` operation)
- Sidebar panel and canvas: `src/renderer/src/components/agent-graph/`, `src/renderer/src/components/right-sidebar/`
- Shared types: `src/shared/agent-graph/agent-graph-types.ts`

## 3. Cross-Terminal Context Sharing

Let one terminal's agent see and act on what another terminal is doing.

- **Share Context to Terminal…**
  1. Orca reads the source terminal, including the rendered screen for terminal apps such as Claude Code or Codex.
  2. A small model summarizes it. The default is Claude Haiku; Claude Sonnet and small Codex models such as GPT-5.6 Luna are also available. Instead of summarizing, you can send the raw screen.
  3. You review and edit the summary.
  4. Orca pastes it into the agent running in the target terminal and submits it.
- **Link with Terminal…**: tells both agents each other's Orca terminal ID and the commands they need, so they can read and type into each other's terminal:
  ```bash
  orca terminal read --terminal <id> --screen
  orca terminal send --terminal <id> --text "..." --enter
  ```
- **Where to start**:
  - the terminal right-click menu
  - the tab right-click menu
  - the Cmd-J command palette
  - the pane headers in a workbench window's Split View, which preselect the other pane as the target

**Limitations**

- Summaries run the `claude` or `codex` CLI on your machine, which must be installed and logged in.
- **Link with Terminal…** only offers partner terminals on the same host as the source.

**Key files**

- Summary generation: `src/main/text-generation/terminal-context-summary-*.ts`, `src/shared/terminal-context-share/`
- IPC and preload: `src/main/ipc/terminal-context-share-handlers.ts`, `src/preload/api/terminal-context-share-bridge.ts`
- Dialogs and menus: `src/renderer/src/components/terminal-context-share/`, `src/renderer/src/components/cmd-j/`
- Split-view buttons: `src/renderer/src/components/workbench-window/WorkbenchTerminalShareActions.tsx`

## 4. Usage Bar for Every Local Account

The status-bar usage meters always show the accounts signed in on this computer.

- **SSH and remote workspaces**: focusing a workspace on an SSH or remote host no longer swaps the bar to that host's usage or to "not set up on host" placeholders. The bar keeps showing your local accounts, and the Claude/Codex account switchers in the bar act on this computer's accounts.
- **Several accounts per provider**: when more than one Claude or Codex account is signed in, each account gets its own meter next to the provider's chip, labeled with the part of its email before `@` (hover for the full address). Their usage refreshes every 5 minutes.

**Limitations**

- Extra-account meters cover Claude and Codex, the providers Orca can hold several accounts for.
- Pending, unavailable, and expired accounts remain listed. Network failures do not mean the account signed out. Claude retries a rejected request only if its credential store contains a newer token; Orca does not compete with Claude's token-refresh locks. Revoked sessions still require signing in again.

**Key files**

- `src/renderer/src/components/status-bar/use-status-bar-controller.ts`
- `src/renderer/src/components/status-bar/use-status-bar-extra-accounts.ts`
- `src/renderer/src/components/status-bar/StatusBarSurface.tsx`
- `src/renderer/src/components/status-bar/ClaudeSwitcherMenu.tsx`, `use-codex-switcher-controller.ts`

## 5. Local Code Distribution and Result Collection

Keep one local source tree and explicitly deploy selected files to several saved runtime environments or connected direct SSH targets. This is a CLI workflow, not automatic bidirectional synchronization.

Create a manifest beside the source tree:

```json
{
  "source": ".",
  "inputs": ["src", "config.yaml"],
  "results": ["results"],
  "targets": [
    {
      "name": "gpu-a",
      "executionHostId": "ssh:TARGET_ID",
      "worktree": "folder:WORKSPACE_ID",
      "directory": "experiment"
    },
    {
      "name": "gpu-b",
      "environment": "SAVED_ENVIRONMENT",
      "worktree": "id:REPO_ID::/absolute/worktree/path",
      "directory": "experiment"
    }
  ]
}
```

Each target names exactly one `executionHostId` or `environment`. Use actual saved IDs; connect direct SSH targets in Orca first. An `environment` target addresses that server's own filesystem, not an SSH host nested under it. `source` is relative to the manifest. Input, result, and destination paths are relative to their respective roots.

```bash
orca file deploy distribution.json
orca file deploy distribution.json --apply
orca file deploy distribution.json --apply --overwrite
orca file collect distribution.json --output ./collected
orca file collect distribution.json --output ./collected --apply
```

Without `--apply`, commands only preview. Deploy snapshots local inputs once for the batch; existing destination files are refused unless `--overwrite` is explicit. Collection requires a new output directory and separates results by target name. `--target gpu-a` selects one target. Run from the local machine, not an SSH-forwarded shell.

Transfers preserve file bytes, not permissions or empty directories. Symbolic links are refused. Pause result writers before collecting: collection does not snapshot a running experiment. Files commit individually; a failed batch can leave completed files on some targets. Output reports partial progress and exits nonzero on failure. No remote files are deleted to mirror the local tree.

## 6. ChatGPT Pro Research Through the Browser

Use the bundled [research workflow](skill-guides/orca-cli/references/research.md) with an Orca browser agent. It selects relevant installed Skills, composes their instructions with the research prompt, and uses the visible ChatGPT interface to submit and retrieve the answer.

Sign in to ChatGPT yourself in Orca Browser, including any verification challenge. Pro modes are available only when that account and the current ChatGPT interface offer them. Orca does not provide a subscription or bypass login.

`orca research prepare` composes a prompt without submitting. `fill`, `submit`, and `read` are separate commands bound to a selected page and expected HTTPS `chatgpt.com` URL. The workflow observes the current UI rather than assuming fixed selectors, sends once, and reads the selected answer with its links. An ambiguous send is not automatically retried.
