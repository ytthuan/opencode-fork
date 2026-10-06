# Goal feature implementation report — October 6, 2026

Implemented in `/private/tmp/opencode-v2-goal`, branch `goal-feature`, base `f96f9e6a52`. No merge or push; no changes to the parent checkout. No subagents spawned. Existing apps and servers were not restarted. Tests used separate in-memory databases, temporary fixture servers, and isolated browser profiles.

## Delivered behavior

- Explicit persistent goals per session: create, inspect, edit, pause, resume, block, complete, clear. An unfinished goal prevents replacement; completed goals may be replaced. Ordinary prompts never create or resume goals.
- SQLite migration adds nullable `session_v2.goal`. Durable mutation events contain new facts; replay derives revisions/round counts. Updates compare **both goal ID and revision**, rejecting stale or replaced goals. Create/resume commits goal state and durable synthetic inbox admission atomically before the existing coordinator is woken.
- Active, armed goals continue after idle model responses. The default cap is 256 automatic follow-up rounds, configurable by the user. The initial explicit admission is separate. Each follow-up may contain several logical model steps. At the cap or agent step allowance the goal blocks with a reason. Every physical model attempt stays in the existing v2 runner.
- Pause/complete/block/clear cancel undelivered goal inputs and stop goal continuation at a safe boundary, preserving ordinary queued prompts. Already running requests/tools finish; existing Stop is the immediate interruption control.
- Continuation authority is process-local. Interruption/failure disarm it. Restarted/imported goals remain durable but require explicit resume. Forks have no goal and need separate user intent.
- Existing `opencode` model namespace gains `goal_get` and `goal_update`, scoped to the caller's session. Models may edit objectives, complete, block, or request pause. They cannot create, resume, clear, or increase the cap. Pause needs both normal tool permission and a direct user confirmation form; cancellation/denial does not mutate the goal.
- Public v2 GET/POST/PATCH goal API; regenerated Promise and Effect client surfaces; shared client metadata refresh on goal events; `Session.Info.goal` available to clients.
- `opencode session goal <sessionID> --action ...` user controls, with objective/cap/reason flags. Shared web/desktop/mobile app goal strip with localized English source keys, multiline objective editor, statuses/rounds/blocker, and pause/resume/complete/clear. Existing TUI can use the same model tools/API, but no dedicated TUI goal dialog or slash command was added.
- Session exports/imports retain goal snapshots. Sanitized export redacts the objective and blocker text.

See `README.md` here for CLI examples, API payloads, exact semantics and upstream study details.

## Upstream provenance

Pinned DeepSeek harness HEAD at **`5badb15009ae1756c3afe0ae0cef1faafc290ccc`**, resolved live October 6, 2026. Studied goal types/domain/fold/runtime/service, round driver/prompt, tools/authority/wrapup, command controls, web GoalBar/activation/input and their documentation. Adapted behavior to native v2 services, not the foreign plugin/projection framework. No upstream source files were copied; the upstream MIT copyright/license is retained in `DEEPSEEK-HARNESS-LICENSE.txt` as attribution.

## Validation

All commands used Bun **1.4.2** from `/private/tmp/opencode-v2-tools/node_modules/@oven/bun-darwin-aarch64/bin`. No runtime dependencies or lockfile changes were added.

| Check | Evidence and outcome |
|---|---|
| Canonical root `bun run check` | **PASS**, all 36 package tasks, 16.773 s; `check-final.log` |
| Core runner, goals, database migrations | **250 PASS, 0 FAIL**, 1,180 expectations; `core-final-tests.log` |
| Full Schema tests | **66 PASS, 0 FAIL**; `schema-final-tests.log` |
| Goal HTTP lifecycle + session import | **4 PASS, 0 FAIL**; `server-goal-tests.log` |
| Promise/Effect goal client wire tests | **2 PASS, 0 FAIL**; `client-goal-tests.log` |
| Focused CLI API/import boundary checks | **8 PASS, 0 FAIL**; `cli-focused-tests.log` |
| Generated client reproducibility | **PASS**, generation repeated with identical file hashes; `generation-verification.txt` |
| Migration generation/check | Generated via Core migration script; no ungenerated migration regression passed in Core suite; `migration.log` |
| Source diff whitespace | `git diff --check` passed |
| Production app build | **PASS** during Playwright benchmark builds; no packaging/release claim |

Regression coverage includes real SQL/Bus persistence and lifecycle, blank input/blocker checks, concurrent create/update winner preservation, stale revisions and replaced IDs, follow-up round cap, direct model tool validation, rejected model resume and unapproved pause, pause before/during execution, ordinary prompt behavior, disarmed resume, agent step allowance, HTTP 409/404/400 behavior and imported paused goal state. Fixtures exercise the actual runner and registry.

## Benchmark evidence and failed broader checks

Required Core location baseline was taken before session changes (`benchmark-before.log`): first 298.00 ms; cached mean 0.01 ms; cold mean **42.41 ms**, p50 40.90 ms, p95 49.06 ms (10 iterations). After (`benchmark-after.log`): first 94.41 ms; cached mean 0.01 ms; cold mean **61.06 ms**, p50 43.85 ms, p95 156.79 ms. The after sample had a large outlier while broader tests ran; this small host sample does **not** establish a performance improvement or a reliable regression threshold.

Also ran the existing production Chrome first-navigation benchmark, without changing its scenario. It **failed its zero-unknown-frame assertion** on both base UI/client files and feature UI/client files: **1 unknown sample, 0 blank samples**, with metrics collected. Raw metrics/logs preserved as `app-benchmark-{baseline,final}.{json,log}`. First/stable destination timing from a single run is not a reliable comparison. The base comparison temporarily restored only the three changed UI/client files and restored all feature bytes afterward; it was an app baseline, not a whole-Core baseline. Initial failed launch attempts (missing Playwright browser, sandbox launch restriction, missing ffmpeg) are preserved in logs. Installed Chrome ran in a separate profile; optional video was disabled to avoid downloading ffmpeg.

Broader Client suite: **212 pass, 4 fail**. All **four failures reproduced unchanged with base files** (`client-baseline-tests.log`, 46 pass / 4 fail across the three implicated suites): existing DateTime input expectation, import-boundary expectation, existing file-write API inventory expectation, existing interrupt query expectation. These were not changed to conceal failures.

Broader CLI suite did not finish: two isolated service-lifecycle convergence cases failed, and the runner was interrupted after stalling. Retained `cli-tests.log`; full CLI suite is **not** claimed passed. Its fixture servers are separate from installed/live servers. Process verification found the task runner and known fixture server PIDs exited after interruption. Focused CLI checks passed independently.

## Remaining limitations

- No token/cost budget accounting, timed goals, goal history browser, background scheduler, or cross-process/cluster ownership. Cap counts automatic idle follow-ups; user control relies on existing coordinator semantics.
- Goal status is durable while armed/disarmed is not surfaced as a separate live UI field; explicit Resume remains available for active goals after restart/interrupt.
- Editing an objective preserves lifecycle and does not interrupt an in-flight model request. The next context load includes the current goal. Active forks intentionally require separate goal creation.
- Model completion remains a semantic assertion; there is no general automatic objective verifier.
- Dedicated TUI controls/story, interactive goal-bar browser regression, packaged desktop/mobile builds and live user-session execution were **not run**. The production browser benchmark used mock session fixtures and is not live-server evidence.
- Full client/CLI suites and the browser frame benchmark are not all green; failures are bounded and disclosed above. No merge/push, signing, installation, packaging or release authorization is claimed.

## Changed paths

- `packages/app/src/runtime/i18n/en.ts`
- `packages/app/src/session/goal-bar.tsx`
- `packages/app/src/session/screen.tsx`
- `packages/cli/src/commands/commands.ts`
- `packages/cli/src/commands/handlers/session/goal.ts`
- `packages/cli/src/index.ts`
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
- `packages/server/test/session-goal.test.ts`
- `packages/server/test/session-import.test.ts`

## Review and cleanup

Commit message: `feat(core): add persistent session goals`. Final source and evidence remain in this checkout for review. The retained artifacts are this report, usage/provenance README, upstream license, command logs, benchmark JSON and reproducibility evidence. Removed the cloned upstream, scratch implementation scripts, temporary benchmark config/results/profiles, build output, and this session's dependency/typecheck caches. No parent checkout or shared Bun tools were removed.
