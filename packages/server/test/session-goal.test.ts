import { expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { Session } from "@opencode/schema/session"
import { SessionGoal } from "@opencode/schema/session-goal"
import { SessionExecution } from "@opencode/core/session/execution"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

it.live("goal HTTP controls persist changes, reject stale revisions, and require explicit creation", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make(
      {
        app: { version: "test" },
        database: { path: ":memory:" },
        fs: { filewatcher: false },
        models: { fetch: false },
      },
      {
        overrides: [SessionExecution.node.replace(Layer.mock(SessionExecution.Service, { wake: () => Effect.void }))],
      },
    )
    const request = (path: string, method = "GET", body?: unknown) =>
      Effect.promise(() =>
        handler(
          new Request(`http://opencode.local${path}`, {
            method,
            headers: { "content-type": "application/json" },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          }),
        ),
      )
    const response = yield* request("/api/session", "POST", { title: "Goal HTTP test" })
    const session = Schema.decodeUnknownSync(Schema.Struct({ data: Schema.toEncoded(Session.Info) }))(
      yield* Effect.promise(() => response.json()),
    ).data
    const path = `/api/session/${session.id}/goal`
    expect(
      yield* Effect.promise(() =>
        handler(new Request(`http://opencode.local${path}`)).then((response) => response.json()),
      ),
    ).toBeNull()
    const created = yield* request(path, "POST", { objective: "Ship feature", maxRounds: 3 })
    expect(created.status).toBe(200)
    const goal = Schema.decodeUnknownSync(SessionGoal.Info)(yield* Effect.promise(() => created.json()))
    const duplicate = yield* request(path, "POST", { objective: "Replace" })
    expect(duplicate.status).toBe(409)
    const paused = yield* request(path, "PATCH", { id: goal.id, revision: goal.revision, action: "pause" })
    expect(paused.status).toBe(200)
    expect(yield* Effect.promise(() => paused.json())).toMatchObject({ status: "paused", revision: 2 })
    const stale = yield* request(path, "PATCH", { id: goal.id, revision: goal.revision, action: "resume" })
    expect(stale.status).toBe(409)
    const info = yield* request(`/api/session/${session.id}`)
    expect(yield* Effect.promise(() => info.json())).toMatchObject({
      data: { goal: { status: "paused", objective: "Ship feature" } },
    })
    const invalid = yield* request(path, "POST", { objective: "", maxRounds: 0 })
    expect(invalid.status).toBe(400)
    const missing = yield* request("/api/session/ses_missing_goal/goal")
    expect(missing.status).toBe(404)
    const cleared = yield* request(path, "PATCH", { id: goal.id, revision: 2, action: "clear" })
    expect(yield* Effect.promise(() => cleared.json())).toBeNull()
  }),
)
