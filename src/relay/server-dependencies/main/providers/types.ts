// Aggregate provider contract surface. The three per-domain contracts live in
// their own files; this barrel keeps every historical `providers/types` import
// path working.

// ─── PTY Provider ───────────────────────────────────────────────────

export type {
  IPtyProvider,
  PtyBackgroundStreamEvent,
  PtyDataEvent,
  PtyProcessInfo,
  PtyProviderBufferSnapshot,
  PtySpawnOptions,
  PtySpawnResult,
  PtyTransientFact
} from '../../../../main/providers/pty-provider-contract'

// ─── Filesystem Provider ────────────────────────────────────────────

export type {
  FileRangeReadResult,
  FileReadLimits,
  FileReadResult,
  FileStat,
  FileUploadSession,
  IFilesystemProvider,
  TerminalArtifactAccessOptions
} from '../../../../main/providers/filesystem-provider-contract'

export { FileRangeReadUnsupportedError } from '../../../../main/providers/filesystem-provider-contract'

// ─── Git Provider ───────────────────────────────────────────────────

export type {
  GitProviderStatusOptions,
  IGitProvider
} from '../../../../main/providers/git-provider-contract'
