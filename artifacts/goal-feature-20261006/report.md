# Goal feature implementation report — October 6, 2026

Implemented in `/private/tmp/opencode-v2-goal`, branch `goal-feature`, based on `f96f9e6a52`. Initial feature commit: `522ac7d873` (`feat(core): add persistent session goals`). Follow-up commit message: `fix(goal): finish runs and add TUI controls`.

Work stayed in this isolated checkout. No parent edits, merge, push, subagents, or restart of existing apps/servers. Tests used separate fixture servers and databases. Bun **1.4.2** came from `/private/tmp/opencode-v2-tools/node_modules/@oven/bun-darwin-aarch64/bin`. No runtime dependencies or lockfile changes were added.

## Concrete feature behavior

- One explicit persistent goal per session: create, inspect, edit, pause, resume, block, complete, clear. An unfinished goal prevents replacement; completed goals can be replaced or cleared. **Ordinary prompts never create or resume goals.**
- SQLite stores nullable `session_v2.goal`. Minimal durable events record changed facts; replay derives revisions and round counts. Mutations compare both goal ID and revision, rejecting stale updates and replaced goals. Create/resume commits the goal and synthetic inbox admission atomically before waking the existing coordinator.
- Active, armed goals continue after idle model responses. The default user-configurable cap is **256 automatic follow-up rounds**; the initial explicit admission is separate. A round can include multiple logical model steps. The round cap or agent step allowance blocks the goal with a reason. All physical model attempts stay in the native v2 runner.
- Pause/complete/block/clear cancel undelivered goal inputs and stop automatic work at a safe boundary. Running requests/tools finish; existing Stop is the immediate interruption control. Ordinary queued prompts remain runnable.
- Model completion or blocking that leaves a tool continuation now receives one grounded closing answer with `toolChoice: "none"`. The previous implementation stopped after the tool result without addressing the user. Newly promoted user instructions take over with normal tools, including input admitted during closing-context preparation. Pause/clear remain safe-boundary stops.
- Continuation authority is process-local. Interruption/failure disarm it. Restarted/imported goals retain their durable snapshot but require explicit resume. Forks start without a goal and need separate user intent.
- Existing model namespace tools `tools.opencode.goal_get()` and `goal_update({ id, revision, action, objective?, reason? })` operate on the caller's session. Models can inspect/edit, complete achieved work, block with a reason, or request pause. They cannot create/resume/clear/increase the cap. Model pause requires existing permission policy plus direct user confirmation; denial/dismissal leaves the goal unchanged.
- Public native v2 GET/POST/PATCH goal API, generated Promise/Effect clients, shared metadata refresh on `session.goal.changed`, and `Session.Info.goal`.
- CLI: `opencode session goal <sessionID> --action get|create|update|pause|resume|block|complete|clear`, with `--objective`, `--max-rounds`, and `--reason`.
- TUI: type `/goal` and select it from autocomplete, or choose **Manage persistent goal** in the command palette. The dialog supports all lifecycle actions, objective/cap edits, blocker reasons, invalid-cap feedback and stale-update recovery. A clickable objective/status/round strip sits above the composer. `session.goal` is an optional keybind, unbound by default. The menu clears its filter after lifecycle changes so newly available actions remain accessible.
- Shared web/desktop/mobile app: **Set goal** strip, English i18n source strings, multiline objective/cap editor, durable status/rounds/blocker, and explicit pause/resume/complete/clear.
- Session export/import retains goal snapshots. Sanitized export redacts objectives and blocker text.

Usage, API payloads and exact semantics are in `README.md` here.

## Upstream study and license

Pinned DeepSeek harness at **`5badb15009ae1756c3afe0ae0cef1faafc290ccc`**, HEAD resolved October 6, 2026. Studied goal types/domain/fold/runtime/service, round-driver/prompt, model tools/authority/wrapup, explicit command controls, web GoalBar/activation/input and package documentation. Revisited closing-response and command behavior at the same pin for the follow-up.

Adapted those behavioral concepts into v2 Schema/Core/Protocol/Server and existing tool/client surfaces. No foreign plugin runtime, v1 implementation, or upstream source files were copied. The upstream MIT copyright/license is retained in `DEEPSEEK-HARNESS-LICENSE.txt` as attribution.

## Final validation

Tests ran from their owning package directories. The canonical check ran from the root.

| Check | Actual result and evidence |
|---|---|
| Root `bun run check` | **PASS**, 36 successful package tasks, 16.575 s. Lint: 1,588 warnings, zero errors. `followup-check-verified.log`; new app test files have zero diagnostics in `followup-app-lint-final.json`. |
| Core goals/runner/execution recovery/retry/instructions | **277 pass, 0 fail**, 1,346 expectations across five files. `followup-core-boundary-final-tests.log`. |
| Production goal execution, HTTP lifecycle and import | **7 pass, 0 fail**, 60 expectations across three files. `followup-server-boundary-final-tests.log`. |
| TUI controls/select/keymap/arguments | **40 pass, 0 fail**, 138 expectations. Full goal lifecycle, `/goal` entry, cap validation and stale-update recovery at widths **40 and 100**. `followup-tui-final-tests.log`. |
| Shared app goal bar | **PASS**, one isolated Happy DOM keeper fixture with 20 expectations plus its wrapper. `followup-app-goal-dom-final.log`, `followup-app-goal-dom-fixture-final.log`. Production Solid component and generated client, deterministic transport replies; no Chrome claim. |
| CLI goal flags and wire contract | **PASS**, 18 expectations, eight actual CLI invocations. `followup-cli-goal-wire.log`. Fixture HTTP replies; domain/runner behavior is owned by Core/Server tests. |
| CLI import/export boundaries | **10 pass, 0 fail**, 42 expectations. `followup-cli-final-tests.log`. |
| Full Schema suite | **66 pass, 0 fail**, 261 expectations. `followup-schema-final-tests.log`. |
| Goal Promise/Effect client wire tests | **2 pass, 0 fail**. `followup-client-final-tests.log`. |
| Migration and original feature checks | Initial phase: **250 pass, 0 fail**, including Core migration coverage. `core-final-tests.log`. Client generation repeated with identical hashes: `generation-verification.txt`. Follow-up changes no public Protocol/HttpApi contract. |
| Formatting and whitespace | Changed/new files pass Prettier; `followup-format-complete.log`, `followup-format-boundary.log`, `followup-format-clean.log`. `git diff --check` passes. |
| Production app build | Passed during benchmark preparation. Packaging and installed-app execution were not run. |

### Production execution evidence

`packages/server/test/session-goal-execution.test.ts` runs the actual `ServerFetch` graph, v2 runner, registry, permissions and Code Mode, **without execution/plugin service replacements**. Its model dependency is a deterministic OpenAI-compatible loopback HTTP/SSE provider.

One case writes actual `goal-result.txt` with the production write tool, reaches idle, automatically continues the goal, reads the file, completes via Code Mode goal tools, and persists a final tool-free answer. Another blocks through the model tool and closes with an explanation. A third pauses while a production request is held, persists to an actual SQLite file, closes/reopens only that isolated test service scope, proves an ordinary prompt leaves it paused, and explicitly resumes to the cap. Scope reopening is same-process persistence evidence, **not process-death or an installed-server restart test**.

Two reproduced runner bugs were fixed. The first exited after Code Mode completed the goal: two provider requests, completed tool result, then idle without a final answer (`followup-missing-final-evidence.json`, raw `followup-server-diagnostics.log`). The second let a user prompt admitted during closing-context preparation inherit disabled tools (`followup-core-user-boundary-first.log`). The final Core suite verifies new user work executes tools while the completed goal stays complete.

## Benchmarks and preserved failures

Required follow-up Core location baseline preceded runner changes: first **297.42 ms**, cached mean **0.00 ms**, cold mean **40.61 ms**, p50 **38.13 ms**, p95 **47.59 ms**, ten iterations (`followup-core-before.log`). The serial final sample after runner fixes: first **88.72 ms**, cached mean **0.00 ms**, cold mean **34.81 ms**, p50 **32.78 ms**, p95 **44.28 ms** (`followup-core-after-settled.log`). Small cache-sensitive local samples do not establish a speed improvement. Command: `bun script/benchmark-location.ts /private/tmp/opencode-v2-goal --iterations 10` from Core, using isolated XDG/TMPDIR paths and `OPENCODE_DB=:memory:`.

Initial feature Core measurements remain in `benchmark-before.log` and `benchmark-after.log`; the latter had an outlier while broader tests ran. Initial production Chrome first-navigation runs failed the zero-unknown-frame assertion for both base and feature UI/client files: one unknown sample, zero blank samples, with metrics (`app-benchmark-{baseline,final}.{json,log}`). This was a UI/client baseline, not a whole-Core baseline.

The follow-up production Chrome session-entry scenario failed its existing `expect(writes).toEqual([])` check before reporting metrics (`followup-app-before-escalated.log`). A warm-tab attempt selected no tests (`followup-app-before-tabs.log`). Additional Chrome benchmarking first hit a content-filter/disconnected approval-review stream, then **automatic approval review explicitly rejected the repeat of the blocked action**. No subsequent Chrome attempt or alternate browser workaround was made. A complete browser before/after comparison remains unavailable; Happy DOM supplies functional component evidence only. `followup-approval-limit.txt` records the limitation.

Broader initial Client suite: **212 pass, 4 fail**; all four failures reproduced with base files (`client-baseline-tests.log`). They concern existing DateTime expectations, import boundaries, file-write API inventory and interrupt query expectations. Broader initial CLI suite stalled after two service-lifecycle convergence failures and was interrupted (`cli-tests.log`). Neither full suite is claimed green; focused final checks pass independently.

Iteration failures remain in logs: TUI dynamic dialog mounting and filter-reset timing were fixed; the test corrected Ctrl+A semantics and a narrow-terminal line-wrap assertion. Expanded Server typecheck fixed possibly undefined ports by using the bound origin. Happy DOM socket attempts failed CORS/preload Response identity; the keeper uses the generated-client transport seam. The first CLI fixture used an unsupported boot option/wrong client shape; the final keeper protects CLI parsing and payloads. Failed evidence is retained separately from passing results.

## Remaining limitations

- No token/cost budget, timed goals, goal history browser, scheduler or clustered/cross-process ownership. Caps count automatic idle follow-ups.
- Armed/disarmed state is not a separate live UI field. Explicit Resume remains available for active goals after restart/interrupt.
- Objective edits preserve lifecycle and do not interrupt running model requests. The next context load includes the updated objective.
- Model completion is a semantic assertion; there is no general automatic verifier.
- `/goal` opens the native management dialog; upstream argument syntax `/goal <objective>` is not implemented. The shared app has no explicit Block button; models/TUI/API/CLI can block.
- No dedicated TUI story, Chrome goal-bar interaction, packaged desktop/mobile build, paid-provider run or live installed-user-session execution. Existing apps/servers were not restarted. No packaging, release, signing, merge or push claim.

## Changed paths

- `packages/app/src/runtime/i18n/en.ts`
- `packages/app/src/session/goal-bar.tsx`
- `packages/app/src/session/screen.tsx`
- `packages/app/test-browser/fixtures/session-goal.ts`
- `packages/app/test-browser/session-goal.test.ts`
- `packages/cli/src/commands/commands.ts`
- `packages/cli/src/commands/handlers/session/goal.ts`
- `packages/cli/src/index.ts`
- `packages/cli/test/session-goal.test.ts`
- `packages/client/src/effect/api/api.ts`
- `packages/client/src/effect/generated/client.ts`
- `packages/client/src/promise/generated/client.ts`
- `packages/client/src/promise/generated/types.ts`
- `packages/client/src/solid/data.ts`
- `packages/client/test/goal.test.ts`
- `packages/core/schema.json`
- `packages/core/src/database/migration.gen.ts`
- `packages/core/src/database/migration/20261006130151_session_goal.ts`
- `packages/core/src/database/schema.gen.ts`
- `packages/core/src/plugin/host.ts`
- `packages/core/src/plugin/internal.ts`
- `packages/core/src/session.ts`
- `packages/core/src/session/context.ts`
- `packages/core/src/session/goal.ts`
- `packages/core/src/session/info.ts`
- `packages/core/src/session/message-updater.ts`
- `packages/core/src/session/projector.ts`
- `packages/core/src/session/runner/llm.ts`
- `packages/core/src/session/runner/step.ts`
- `packages/core/src/session/sql.ts`
- `packages/core/src/session/transfer.ts`
- `packages/core/src/tool/plugin/goal.ts`
- `packages/core/test/plugin/host.ts`
- `packages/core/test/session-goal.test.ts`
- `packages/core/test/session-runner.test.ts`
- `packages/core/test/v1-migration.test.ts`
- `packages/plugin/src/effect/session.ts`
- `packages/protocol/src/groups/session.ts`
- `packages/schema/src/index.ts`
- `packages/schema/src/session-event.ts`
- `packages/schema/src/session-goal.ts`
- `packages/schema/src/session.ts`
- `packages/schema/test/event-manifest.test.ts`
- `packages/schema/test/session-goal.test.ts`
- `packages/server/src/handlers/session.ts`
- `packages/server/test/session-goal-execution.test.ts`
- `packages/server/test/session-goal.test.ts`
- `packages/server/test/session-import.test.ts`
- `packages/tui/src/component/dialog-session-goal.tsx`
- `packages/tui/src/config/keybind.ts`
- `packages/tui/src/routes/session/index.tsx`
- `packages/tui/test/session-goal.test.tsx`

## Review and cleanup

Initial commit: `522ac7d873`. Follow-up: `fix(goal): finish runs and add TUI controls`. Source, report, usage/provenance README, license, selected verification/failure evidence and benchmark data remain here for review. Raw validation logs remain locally under this artifact directory. Lossless `.log.gz` archives of the TUI and failed Chrome logs are committed to preserve terminal whitespace; the validation manifest records hashes of their original uncompressed bytes.

The follow-up removes its task-installed root/package dependencies, build/typecheck/turbo caches, isolated XDG/test data, cloned Effect reference and temporary browser config/results. `followup-cleanup.txt` records actual removed paths. The read-only process check found only its own command using this checkout before cleanup. Shared Bun tools and the parent checkout were not modified.
