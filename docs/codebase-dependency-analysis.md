# Codebase dependency analysis

Open `out/graphify-out/graph.html` for the interactive subsystem map. It represents 20 subsystems and 56 directed connections, **not** the full symbol graph. The full extraction is `out/graphify-out/graph.json`.

## CI cancellation findings

The reported four macOS annotations match [run 43446844586](https://github.com/myunhh/orca/actions/runs/43446844586).

| Job                                                                                             | Observed evidence                                                                                                                                        | Conclusion                                                             |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `warm-platforms / warm-macos-runtime`                                                           | No assigned runner or executed steps; “The job was not acquired by Runner of type hosted even after multiple attempts”; three macOS ARM capacity notices | GitHub runner allocation failure, not a compilation failure            |
| `warm (blacksmith-4vcpu-ubuntu-2404)`                                                           | No assigned runner or steps; cancelled because a higher-priority request was waiting for the same concurrency group                                      | Queued work was superseded                                             |
| Blacksmith warmup in [run 43529952919](https://github.com/myunhh/orca/actions/runs/43529952919) | “repository invocation blocked”; no assigned runner or steps                                                                                             | The fork cannot invoke that runner pool                                |
| Hosted jobs in run 43529952919                                                                  | Linux, macOS, Windows and mobile-bundle warmup jobs succeeded                                                                                            | The observed failure is not common to the dependency installation path |

### Applied changes

1. `.github/workflows/ci-cache-warmup.yml`: forks schedule only the GitHub-hosted Linux cache producer.
2. `.github/workflows/ci-cache-warmup-platform-jobs.yml`: fork runtime and package-fixture matrices exclude Blacksmith; hosted ARM/x64, macOS and Windows coverage stays intact.
3. `.github/workflows/ci-xterm-cache.yml`: the same policy applies to the xterm dependency cache.
4. `src/main/ai-vault/scan-service/session-scanner-background.ts`: import `localAiVaultScanRoots` directly and statically from its owning module instead of dynamically importing the `cached-session-list` re-export. This removes the scanner/cache-controller cycle without changing the public API.
5. Publication preflight repairs: make the orcad template fingerprint and refusal-recording chain asynchronous; reuse `installWindowVisibilityInterval` for Agent Graph and extra-account usage refreshes so hidden windows stop polling.

The existing upstream repository guard convention is retained: `stablyai/orca` still warms both cache stores. No blanket `continue-on-error`, retries, timeout increases or macOS architecture substitutions were added. GitHub's macOS capacity shortage cannot be repaired by a source change.

The expanded renderer gates also exposed non-reactive render-time translations in Agent Graph, terminal sharing and workbench windows. These now use `useTranslate()` / `useIntlLocale()`, with reactive translators passed to copy helpers. Async graph and sharing operations no longer put unsupported finalizers inside compiled hooks; graph fallback refs update in an effect. Existing focus-read and compiler-bailout baseline allowances were reduced to match improvements, never increased.

## Graph coverage

Graphify `0.9.108` with its SQL extra performed local, code-only AST extraction. No source was sent to an LLM. Clustering of the full symbol graph was disabled; the interactive HTML is a separate aggregated view.

| Artifact / coverage                             |      Result |
| ----------------------------------------------- | ----------: |
| Graphify code-file manifest                     |      36,964 |
| Full symbol graph nodes                         |     229,126 |
| Full symbol graph edges                         |     886,679 |
| Supplemental TypeScript/JavaScript source files |      35,763 |
| Resolved local module-request edges             |     169,870 |
| Explicit type-only edges                        |      45,390 |
| Package manifests / lockfiles / workflows       | 23 / 5 / 76 |
| Additional native Cargo manifests inspected     |           2 |

The supplemental module graph reuses `collectModuleSpecifiers` and `createWorkspaceSourceResolver`, with TypeScript module resolution and the renderer, mobile and docs-site aliases. It covers source, tests, tooling, `.github`, native JS entry points, cloud, mobile and docs code. The two Rust executables depend on `winresource` at build time and declare no runtime crates; root-level Graphify Cargo discovery alone finds only one of these independent packages.

### Artifacts

All generated files are under the already-ignored `out/graphify-out/` directory:

| File                                    | Purpose                                                                             |
| --------------------------------------- | ----------------------------------------------------------------------------------- |
| `graph.json`, `manifest.json`, `cache/` | Full Graphify extraction and incremental scan state                                 |
| `module-dependencies.json`              | Resolved module edges, package manifests, lockfile counts and workflow dependencies |
| `dependency-analysis.json`              | Cycles, unresolved requests, high-fan-in modules and native crate dependencies      |
| `architecture.json`, `graph.html`       | Aggregated, interactive subsystem map                                               |
| `graph-preview.png`                     | Rendered visual proof, 2343 × 1423, dark theme, all subsystems selected             |

Regenerate the full extraction from the repository root:

```sh
uvx --from 'graphifyy[sql]==0.9.108' graphify extract . \
  --code-only --cargo --max-workers 4 --out out --no-cluster
```

The supplemental analysis and subsystem visualization are snapshots from the CI/dependency investigation, before the subsequent publication-preflight repairs. The command above regenerates the full symbol graph, not those supplemental snapshots. Generated artifacts are local and will not accompany a normal Git commit.

## Dependency findings

The production-source module graph contains 25,329 files and 92,027 distinct directed edges after excluding explicit type-only requests. The scanner/cache-controller change reduces cyclic strongly connected components from **6 to 5**, and files within those components from **274 to 272**.

The remaining components are static coupling candidates, **not five confirmed runtime failures**. Dynamic imports are included, and unused value imports or inline type-only specifiers can over-approximate runtime coupling.

| Remaining component                                     | Files | Assessment                                                              |
| ------------------------------------------------------- | ----: | ----------------------------------------------------------------------- |
| Renderer store and its dependency closure               |   253 | Largest coupling group; `store/index.ts` has 1,623 production importers |
| Browser manager and extension adapters                  |     8 | Cross-layer manager/adapter cycle                                       |
| SSH user-disconnect and runtime-environment handlers    |     5 | Lifecycle and handler-registration coupling                             |
| GitHub account environment, tokens and capability state |     4 | Authentication/CLI coupling                                             |
| Managed tunnel and SSH launch-session notes             |     2 | Includes a lazy reverse dependency                                      |

These components were not broadly rewritten without a demonstrated behavioral defect. Their complete file lists remain in `dependency-analysis.json`.

No resolved, non-explicit-type-only import from `src/shared` into main/renderer, or from renderer into main, was found under this analysis's resolution rules. Existing process-host and compatibility-boundary checks passed. The process-host ratchet still permits 75 legacy direct process importers; this change does not claim to remove them.

### Analysis limits

1. Graphify skipped 628 non-code inputs, 241 unclassified files and five sensitive-file candidates. One Android Gradle file was only partially parsed. Six SQL query files were reprocessed with SQL support but define no graph symbols. Empty extractions are not evidence of unused code.
2. Graphify's incremental pass reported that it retained nodes from one still-existing file outside the updated scan corpus. The symbol graph is an extraction aid, not a compiler-backed completeness proof.
3. The module graph retains 25 unresolved local requests, including generated mobile/docs bundles, native build outputs and requests whose `createRequire` base differs from the importing file. They are preserved for inspection, not asserted to be 25 broken imports. Computed imports and runtime-selected dependencies are not exhaustively resolved.
4. Lockfile consistency is checked; a fresh vulnerability audit was not run. No package versions or dependency policies were changed.

## Verification

| Check                                | Observed result                                                                                                                   |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| GitHub Actions expression evaluation | 48 scenarios passed: four matrices × three repositories × four event types                                                        |
| actionlint 1.7.12                    | Four cache workflows passed; shellcheck and pyflakes disabled because this change only alters matrix expressions                  |
| Existing AI Vault tests              | Two files, seven tests passed                                                                                                     |
| Existing SSH host-connect tests      | Three files, 13 tests passed, including the asynchronous refusal lookup                                                           |
| Template fingerprint smoke           | Real temporary files: absent templates, candidate priority, changed manifest and unreadable first candidate passed                |
| Rendered refresh smoke               | Seven lifecycle scenarios passed in headless Chromium at 1000 × 650; actual hooks with controlled API/store, clock and visibility |
| Existing import-boundary checks      | Process-host and both compatibility boundaries passed                                                                             |
| Root/mobile shared-version contract  | All eight checked dependencies match                                                                                              |

Tests executed:

```sh
ORCA_BACKGROUND_LAUNCH=1 npm exec --yes --package=pnpm@12.14.0 -- \
  pnpm test src/main/ai-vault/cached-session-list-wsl-probe.test.ts \
  src/main/ai-vault/session-first-user-prompt-read.test.ts --maxWorkers=2
ORCA_BACKGROUND_LAUNCH=1 npm exec --yes --package=pnpm@12.14.0 -- \
  pnpm test src/main/ssh/host-server/ssh-host-server-on-connect.test.ts \
  src/main/ssh/host-server/ssh-host-server-on-connect-node-download.test.ts \
  src/main/ssh/host-server/ssh-host-server-on-connect-telemetry.test.ts --maxWorkers=2
```

The checkout initially had no installed dependencies. A frozen, script-free install succeeded; the first test attempt stopped before tests because Bun's postinstall had not run. After `pnpm rebuild bun`, the targeted tests passed. The existing test command also built the process-host package and Linux node-pty runtime.

The generated graph HTML was opened in Orca's browser and its rendered canvas inspected. The refresh-hook smoke verified hidden mount, initial visible data, hidden suspension, visible resumption, failure backoff, single-flight loading and unmount cleanup. Its screenshot is `out/graphify-out/refresh-smoke.png`; native Electron window focus was not exercised. Temporary verification scripts were removed.

The production Agent Graph fixture rendered without page errors in dark and light themes. A temporary fixture using the normal React-Compiler-enabled renderer verified in-place translation-scope updates across graph labels/helpers, terminal selection and workbench controls; updated graph fallback arguments, surfaced errors and single-flight requests; and raw/summary generation, failures and cancellation preserving the prior preview. API responses and translation scopes were controlled; screenshots remain under `out/graphify-out/fixtures/`, and the temporary fixture was removed.

The publication preflights passed the node, web and CLI typechecks. They exposed existing synchronous-filesystem, timer, translation and compiler violations, repaired without relaxing policy baselines. The broad related-test selection did not complete after 17 minutes on the initial attempt; a bounded retry timed out after two minutes. Focused tests and rendered checks provide scoped evidence, not a full-suite or remote-CI pass. Publication still requires running `pnpm check:changed` after the final edit; report any remaining bounded related-test timeout separately.
