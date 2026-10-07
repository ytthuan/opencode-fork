# Persistent session goals

A goal is explicit, session-owned intent. Ordinary prompts never create a goal. Use **Set goal** in the shared web/desktop app, select **Manage persistent goal** in the TUI command palette, or type `/goal` and select it from autocomplete. The TUI command opens the goal dialog; objective text is entered in that dialog. The CLI also supports explicit goal controls:

```sh
opencode session goal ses_example --action create --objective "Ship the migration" --max-rounds 20
opencode session goal ses_example
opencode session goal ses_example --action pause
opencode session goal ses_example --action update --objective "Finish the migration and docs" --max-rounds 30
opencode session goal ses_example --action resume
opencode session goal ses_example --action complete
opencode session goal ses_example --action clear
```

Commands use the normal server connection parameters. Goal creation and resume admit a durable synthetic input and wake the existing session coordinator. The default cap is 256 automatic follow-up rounds; the initial explicit input is separate. A round can contain multiple model steps and tools. The selected agent's step allowance still applies and blocks a goal when exhausted.

The app and TUI expose the objective, durable status, automatic round count/cap, and blocker reason. The TUI dialog supports creation, objective and cap edits, pause, resume, block with a reason, completion, and clearing. Its optional keybind is `session.goal` (unbound by default); the status strip is clickable. Stale updates show an error and reload the latest goal before a user retries. Edit preserves status. Pause, completion, blocking and clearing stop goal-driven continuation at the next safe boundary and cancel undelivered goal inputs. They do not abort an already running model request or tool; use the existing Stop control when interruption is necessary. When completion or blocking leaves a tool continuation, the runner allows one closing response with tools disabled, grounded in the session results. Newly promoted user input takes over normal execution and keeps tools available. Ordinary queued prompts stay available.

`active`, `paused`, `blocked`, and `complete` persist in SQLite and session exports. Automatic continuation authority is process-local: restart, failure and interruption disarm it, and imported goals do not acquire continuation authority. Explicit **Resume goal** rearms an active, paused or blocked goal. Completed goals may be replaced or cleared but cannot resume. A fork begins without a goal; it requires separate user intent.

## API and model tools

- `GET /api/session/:sessionID/goal` returns the current goal or `null`.
- `POST /api/session/:sessionID/goal` explicitly creates a goal from `{ objective, maxRounds? }`.
- `PATCH /api/session/:sessionID/goal` takes `{ id, revision, action, objective?, maxRounds?, reason? }`. Both goal identity and revision must match. Actions are `update`, `pause`, `resume`, `complete`, `block`, and `clear`; conflicts return HTTP 409. Use `update` for objective/cap edits or `resume` for a cap increase plus resume. Blocking requires a reason.

The generated Promise and Effect clients expose `session.goal`, `session.createGoal`, and `session.updateGoal`. `Session.Info.goal` is browser-safe. The durable `session.goal.changed` event carries only the changed facts and expected predecessor identity; the projector derives revision and round counts. Shared clients refresh session metadata when it arrives.

Model tools live in the existing `opencode` namespace: `tools.opencode.goal_get({})` and `tools.opencode.goal_update({ id, revision, action, objective?, reason? })`. They operate on the caller's session only. Models can inspect/edit existing goals, complete achieved goals, or record a blocker. They cannot create, clear, resume, or increase the round cap. A model pause requires the existing permission policy plus a direct user confirmation form. Denial/dismissal leaves the goal active. Model completion is a semantic assertion by the model, not independent verification of the objective.

## Upstream study and licensing

Studied `deepseek-ai/deepseek-harness` at commit `5badb15009ae1756c3afe0ae0cef1faafc290ccc` (HEAD resolved October 6, 2026):

- `packages/goal/goal/src/{types,domain,fold,runtime,index}.ts` and package README: one current goal, stable identity/revisions, persisted phases and process-local activation.
- `packages/goal/goal-round-driver/src/{index,prompt}.ts` and README: explicit continuation authority, follow-up admission, limits, restart/fork disarming and invalidation.
- `packages/goal/tool-goal/src/{index,authority,wrapup}.ts` and README: distinguish human authority from autonomous work and constrain lifecycle mutations.
- `packages/goal/command-goal/src/index.ts` and README: explicit user commands.
- `packages/client/ui-goal/src/client/{GoalBar,activation-source,goal-command-input}.ts*` and README: projected objective/status strip, user controls, revision checks and inline errors.

This implementation adapts those behavioral concepts into v2 Schema, Core, Protocol, Server and the existing tool/app surfaces. It imports no foreign plugin runtime and adds no v1 implementation. No upstream source files are copied. The upstream MIT license is retained in `DEEPSEEK-HARNESS-LICENSE.txt` for attribution of the studied design.
