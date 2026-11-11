# Orca Customizations

This fork adds four features to Orca: detached workbench windows, an agent graph, cross-terminal context sharing, and a usage bar that shows every local account.

All changes sit on top of upstream commit `aefcdd99` and live in the commit range `aefcdd99..76cda768`. To carry them onto another base, apply that range:

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

## SSH hosts: getting the server template

To work on an SSH host, Orca installs its own server there from a server template bundled with the app. Release builds include it. Builds of this fork made with `pnpm dev` or a local packaging run do not, so connecting to an SSH host shows **"This host isn't supported by this version of Orca"**. Building the template needs node-pty compiled on Linux, macOS and Windows, so it is made on GitHub Actions and downloaded once:

```bash
node fork-maintenance/fetch-orcad-template.mjs --build
```

This starts the template build on your fork's Actions (about 30-60 minutes), then puts the result in `out/orcad-template`. It needs the GitHub CLI signed in (`gh auth login`) and Actions enabled on the fork. Afterwards restart `pnpm dev` or rebuild the app, then reconnect the host; Orca retries hosts it gave up on while the template was missing.

- Without `--build`, the script downloads the newest template your fork's Actions already built. Templates stay downloadable for 7 days.
- Fetch the template again after syncing upstream, because the server code changes with it.

## 1. Detached Workbench Windows

Move terminals, Markdown files and images into separate windows, the way Chrome lets you drag a tab out into its own window.

- **Move to New Window**: right-click a terminal tab, a Markdown tab or an image tab and choose **Move to New Window**.
- **Move to Window ▸**: send a tab to a workbench window that is already open.
- **Multiple tabs per window**: each workbench window has its own tab strip. You can switch tabs, close them, or open more.
  - **+** opens a new terminal in the workspace of the active tab.
  - **Add Existing Tab…** pulls in a terminal, Markdown tab or image tab that is open in the main window.
- **Split View**: show two tabs side by side in the same window.
- **Return to Main Window**: send a tab back. Closing a workbench window returns all of its tabs to the main window, and their terminals keep running.
- **Live terminals**: terminals in a workbench window are fully interactive. The main window still owns every process and every saved layout, so no terminal is ever killed when it moves between windows.

**Limitations**

- Markdown and image tabs are read-only in a workbench window. Use **Reload** to pick up changes on disk.
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
- An account appears once Orca has read its usage at least once.

**Key files**

- `src/renderer/src/components/status-bar/use-status-bar-controller.ts`
- `src/renderer/src/components/status-bar/use-status-bar-extra-accounts.ts`
- `src/renderer/src/components/status-bar/StatusBarSurface.tsx`
- `src/renderer/src/components/status-bar/ClaudeSwitcherMenu.tsx`, `use-codex-switcher-controller.ts`
