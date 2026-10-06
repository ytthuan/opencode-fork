import { expect } from "bun:test"
import path from "node:path"
import { Effect, Schema } from "effect"
import { Session } from "@opencode/schema/session"
import { SessionGoal } from "@opencode/schema/session-goal"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const ChatRequest = Schema.Struct({
  model: Schema.String,
  messages: Schema.Array(
    Schema.StructWithRest(Schema.Struct({ role: Schema.String }), [Schema.Record(Schema.String, Schema.Json)]),
  ),
  tool_choice: Schema.optionalKey(Schema.String),
  tools: Schema.Array(Schema.Struct({ function: Schema.Struct({ name: Schema.String }) })),
})

const stream = (content: { text: string } | { tool: string; input: Schema.Json }) => {
  const delta =
    "text" in content
      ? { content: content.text }
      : {
          tool_calls: [
            {
              index: 0,
              id: crypto.randomUUID(),
              type: "function",
              function: { name: content.tool, arguments: JSON.stringify(content.input) },
            },
          ],
        }
  return new Response(
    [
      {
        id: "chat_goal",
        object: "chat.completion.chunk",
        created: 1,
        model: "goal-fixture",
        choices: [{ index: 0, delta, finish_reason: null }],
      },
      {
        id: "chat_goal",
        object: "chat.completion.chunk",
        created: 1,
        model: "goal-fixture",
        choices: [{ index: 0, delta: {}, finish_reason: "text" in content ? "stop" : "tool_calls" }],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      },
    ]
      .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
      .join("") + "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } },
  )
}

type Handler = (request: Request) => Promise<Response>
const request = (handler: Handler, route: string, method = "GET", body?: unknown) =>
  Effect.promise(() =>
    handler(
      new Request(`http://opencode.local${route}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    ),
  )
const goal = (handler: Handler, sessionID: string) =>
  request(handler, `/api/session/${sessionID}/goal`).pipe(
    Effect.flatMap((response) => Effect.promise(() => response.json())),
    Effect.map(Schema.decodeUnknownSync(SessionGoal.Info)),
  )
const wait = (handler: Handler, sessionID: string) =>
  request(handler, `/api/experimental/session/${sessionID}/wait`, "POST").pipe(
    Effect.tap((response) => Effect.sync(() => expect(response.status).toBe(204))),
    Effect.timeout("10 seconds"),
  )
const create = (handler: Handler, directory: string) =>
  request(handler, "/api/session", "POST", { title: "Production goal flow", location: { directory } }).pipe(
    Effect.tap((response) => Effect.sync(() => expect(response.status).toBe(200))),
    Effect.flatMap((response) => Effect.promise(() => response.json())),
    Effect.map((body) => Schema.decodeUnknownSync(Schema.Struct({ data: Schema.toEncoded(Session.Info) }))(body).data),
  )

const config = (directory: string, origin: string) => ({
  directory,
  project: false,
  content: JSON.stringify({
    model: "goal-fixture/goal-fixture",
    snapshots: false,
    permissions: [{ action: "edit", resource: "*", effect: "allow" }],
    providers: {
      "goal-fixture": {
        package: "@opencode/ai/providers/openai-compatible",
        settings: { baseURL: `${origin}/v1`, apiKey: "fixture" },
        models: { "goal-fixture": { capabilities: { tools: true }, limit: { context: 32000, output: 1024 } } },
      },
    },
  }),
})

const serve = (directory: string, origin: string, database = ":memory:") =>
  ServerFetch.make({
    app: { version: "goal-execution-test" },
    database: { path: database },
    models: { fetch: false },
    fs: { filewatcher: false, fff: false },
    config: config(directory, origin),
  })

it.live(
  "goal HTTP creation drives production file tools, automatic continuation and a final answer",
  () =>
    Effect.gen(function* () {
      const directory = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-goal-execution-")))
      const requests: Array<typeof ChatRequest.Type> = []
      const model = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            hostname: "127.0.0.1",
            port: 0,
            fetch: async (request) => {
              requests.push(Schema.decodeUnknownSync(ChatRequest)(await request.json()))
              if (requests.length === 1)
                return stream({
                  tool: "write",
                  input: { path: "goal-result.txt", content: "verified goal artifact\n" },
                })
              if (requests.length === 2) return stream({ text: "The artifact was written; verification remains." })
              if (requests.length === 3) return stream({ tool: "read", input: { path: "goal-result.txt" } })
              if (requests.length === 4)
                return stream({
                  tool: "execute",
                  input: {
                    code: 'const goal = await tools.opencode.goal_get(); return await tools.opencode.goal_update({ id: goal.id, revision: goal.revision, action: "complete" });',
                  },
                })
              return stream({ text: "Goal achieved. goal-result.txt was written and read back successfully." })
            },
          }),
        ),
        (server) => Effect.promise(() => server.stop(true)),
      )
      const handler = yield* serve(directory.path, model.url.origin)
      const session = yield* create(handler, directory.path)
      const started = yield* request(handler, `/api/session/${session.id}/goal`, "POST", {
        objective: "Write and verify goal-result.txt",
        maxRounds: 3,
      })
      expect(started.status).toBe(200)
      yield* wait(handler, session.id)
      expect(yield* goal(handler, session.id)).toMatchObject({
        status: "complete",
        rounds: 1,
        objective: "Write and verify goal-result.txt",
      })
      expect(requests).toHaveLength(5)
      expect(requests[4]?.tool_choice).toBe("none")
      expect(JSON.stringify(requests[4]?.messages)).toContain("Give the user a final response")
      expect(requests[0]?.tools.some((tool) => tool.function.name === "execute")).toBe(true)
      expect(JSON.stringify(requests[2]?.messages)).toContain("Continue the persistent goal")
      expect(JSON.stringify(requests[3]?.messages)).toContain("verified goal artifact")
      expect(yield* Effect.promise(() => Bun.file(path.join(directory.path, "goal-result.txt")).text())).toBe(
        "verified goal artifact\n",
      )
      const context = yield* request(handler, `/api/session/${session.id}/context`)
      expect(context.status).toBe(200)
      const transcript = JSON.stringify(yield* Effect.promise(() => context.json()))
      expect(transcript).toContain('"status":"completed"')
      expect(transcript).toContain("Goal achieved. goal-result.txt was written and read back successfully.")
    }),
  30_000,
)

it.live(
  "a model blocker produces a final response and explicit resume respects the goal cap",
  () =>
    Effect.gen(function* () {
      const directory = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-goal-blocker-")))
      const requests: Array<typeof ChatRequest.Type> = []
      const model = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            hostname: "127.0.0.1",
            port: 0,
            fetch: async (request) => {
              requests.push(Schema.decodeUnknownSync(ChatRequest)(await request.json()))
              if (requests.length === 1)
                return stream({
                  tool: "execute",
                  input: {
                    code: 'const goal = await tools.opencode.goal_get(); return await tools.opencode.goal_update({ id: goal.id, revision: goal.revision, action: "block", reason: "The required fixture input is missing." });',
                  },
                })
              return stream({ text: "I need the required fixture input to continue." })
            },
          }),
        ),
        (server) => Effect.promise(() => server.stop(true)),
      )
      const handler = yield* serve(directory.path, model.url.origin)
      const session = yield* create(handler, directory.path)
      yield* request(handler, `/api/session/${session.id}/goal`, "POST", {
        objective: "Use required fixture input",
        maxRounds: 1,
      })
      yield* wait(handler, session.id)
      const blocked = yield* goal(handler, session.id)
      expect(blocked).toMatchObject({ status: "blocked", reason: "The required fixture input is missing.", rounds: 0 })
      expect(requests).toHaveLength(2)
      expect(requests[1]?.tool_choice).toBe("none")
      yield* request(handler, `/api/session/${session.id}/goal`, "PATCH", {
        id: blocked.id,
        revision: blocked.revision,
        action: "resume",
      })
      yield* wait(handler, session.id)
      expect(requests).toHaveLength(4)
      expect(yield* goal(handler, session.id)).toMatchObject({
        status: "blocked",
        rounds: 1,
        reason: "Goal round limit reached. Increase the limit and explicitly resume.",
      })
    }),
  30_000,
)

it.live(
  "pause during a production request persists across service reopening and ordinary prompts do not resume it",
  () =>
    Effect.gen(function* () {
      const directory = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-goal-reopen-")))
      const started = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const requests: Array<typeof ChatRequest.Type> = []
      const model = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            hostname: "127.0.0.1",
            port: 0,
            fetch: async (request) => {
              requests.push(Schema.decodeUnknownSync(ChatRequest)(await request.json()))
              if (requests.length === 1) {
                started.resolve()
                await release.promise
              }
              return stream({ text: "Progress remains." })
            },
          }),
        ),
        (server) => Effect.sync(() => release.resolve()).pipe(Effect.andThen(Effect.promise(() => server.stop(true)))),
      )
      const database = path.join(directory.path, "goals.sqlite")
      const saved = yield* Effect.gen(function* () {
        const handler = yield* serve(directory.path, model.url.origin, database)
        const session = yield* create(handler, directory.path)
        yield* request(handler, `/api/session/${session.id}/goal`, "POST", {
          objective: "Keep progressing",
          maxRounds: 1,
        })
        yield* Effect.promise(() => started.promise).pipe(Effect.timeout("10 seconds"))
        const current = yield* goal(handler, session.id)
        yield* request(handler, `/api/session/${session.id}/goal`, "PATCH", {
          id: current.id,
          revision: current.revision,
          action: "pause",
        })
        release.resolve()
        yield* wait(handler, session.id)
        expect(requests).toHaveLength(1)
        expect(yield* goal(handler, session.id)).toMatchObject({ status: "paused", rounds: 0 })
        return session
      }).pipe(Effect.scoped)
      const reopened = yield* serve(directory.path, model.url.origin, database)
      expect(yield* goal(reopened, saved.id)).toMatchObject({ status: "paused", rounds: 0 })
      expect(requests).toHaveLength(1)
      yield* request(reopened, `/api/session/${saved.id}/prompt`, "POST", { text: "Answer this ordinary question" })
      yield* wait(reopened, saved.id)
      expect(requests).toHaveLength(2)
      const paused = yield* goal(reopened, saved.id)
      expect(paused.status).toBe("paused")
      yield* request(reopened, `/api/session/${saved.id}/goal`, "PATCH", {
        id: paused.id,
        revision: paused.revision,
        action: "resume",
      })
      yield* wait(reopened, saved.id)
      expect(requests).toHaveLength(4)
      expect(yield* goal(reopened, saved.id)).toMatchObject({ status: "blocked", rounds: 1 })
    }),
  30_000,
)
