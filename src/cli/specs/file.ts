import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const FILE_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['file', 'deploy'],
    destructive: true,
    summary: 'Preview or deploy local code and data to the hosts in a distribution manifest',
    usage: 'orca file deploy <manifest> [--target <name>] [--apply] [--overwrite] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'manifest', 'target', 'apply', 'overwrite'],
    positionalArgs: ['manifest'],
    notes: [
      'The manifest contains source, inputs, results and targets. Each target names an exact id: or folder: worktree selector and a relative directory. Set environment for a paired server, or executionHostId (ssh:<target-id>) for direct SSH.',
      'Without --apply, only list destinations. --apply snapshots selected local files once before transferring the same bytes to each host. --overwrite explicitly allows replacing destination files.',
      'Only listed input paths are copied. Symlinks are refused; file permissions and empty directories are not replicated. No destination files are deleted.',
      'Transfers are per-file, not a transaction across hosts. A failure reports completed counts and exits unsuccessfully; inspect partial results before retrying.'
    ],
    examples: [
      'orca file deploy experiments.json',
      'orca file deploy experiments.json --target gpu-a --apply --overwrite'
    ]
  },
  {
    path: ['file', 'collect'],
    summary: 'Collect experiment results into separate local directories for each host',
    usage: 'orca file collect <manifest> --output <directory> [--target <name>] [--apply] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'manifest', 'output', 'target', 'apply'],
    positionalArgs: ['manifest'],
    notes: [
      'Uses the manifest results paths on each target workspace. Preview lists remote files; --apply writes them below output/<target-name>.',
      'The output directory must not already exist. Collection never overwrites the local source tree or previous results.',
      'Collect completed experiments: remote files can change while being read. Symlinks are refused. Failed batches retain completed results and report an unsuccessful exit.'
    ],
    examples: ['orca file collect experiments.json --output results/run-001 --apply']
  },
  {
    path: ['file', 'open'],
    summary:
      'Open a file as a tab in its worktree without changing your view; --focus brings you to it',
    usage:
      'orca file open <path> [--line <n> [--column <n>]] [--worktree <selector>] [--focus] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'path', 'line', 'column', 'worktree', 'focus'],
    positionalArgs: ['path'],
    notes: [
      '--line and --column use 1-based positions; --column requires --line. Without --focus, the position is applied when you select the file. Markdown opens in source view for positioning. Older hosts open the file without positioning.',
      'The file opens as a tab in that worktree without changing what you are looking at, even in the worktree on screen. --focus brings you to it; agents should pass --focus only when the user asked to see the file.',
      'The path may be relative to the selected worktree or an absolute path inside that worktree. When --worktree is omitted, local CLI calls infer the current Orca worktree from cwd.',
      'A server with no app window (`orca serve`, orcad) cannot open tabs, so this fails with renderer_unavailable and opens nothing.'
    ],
    examples: [
      'orca file open src/App.tsx',
      'orca file open src/App.tsx --line 42 --column 7 --focus',
      'orca file open --path docs/readme.md --worktree active --focus'
    ]
  },
  {
    path: ['file', 'diff'],
    summary:
      'Open a file diff as a tab in its worktree without changing your view; --focus brings you to it',
    usage: 'orca file diff <path> [--staged] [--worktree <selector>] [--focus] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'path', 'staged', 'worktree', 'focus'],
    positionalArgs: ['path'],
    notes: [
      'The file opens as a tab in that worktree without changing what you are looking at, even in the worktree on screen. --focus brings you to it; agents should pass --focus only when the user asked to see the file.',
      'Diffs default to unstaged changes. Pass --staged to open the staged source-control diff.',
      'The path may be relative to the selected worktree or an absolute path inside that worktree.'
    ],
    examples: [
      'orca file diff src/App.tsx',
      'orca file diff --path package.json --staged --worktree branch:feature'
    ]
  },
  {
    path: ['file', 'open-changed'],
    summary:
      'Open all git-changed files as tabs without changing your view; --focus brings you to them',
    usage:
      'orca file open-changed [--mode edit|diff|both] [--worktree <selector>] [--focus] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'mode', 'worktree', 'focus'],
    notes: [
      'The files open as tabs in that worktree without changing what you are looking at, even in the worktree on screen. --focus brings you to them; agents should pass --focus only when the user asked to see the files.',
      'For v1, changed files come from git status for the selected worktree.',
      'The default mode is diff. Edit mode skips deleted files because there is no file to open.'
    ],
    examples: [
      'orca file open-changed',
      'orca file open-changed --mode both',
      'orca file open-changed --mode diff --worktree active'
    ]
  }
]
