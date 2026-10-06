import { expect } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Schema, Stream } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { LLM, LLMEvent } from "../src/index.js"
import { OpenAI } from "../src/providers.js"
import { LLMClient } from "../src/route/client.js"
import { Tool } from "../src/tool.js"
import { ToolRuntime } from "../src/tool-runtime.js"
import { testEffect } from "./lib/effect.js"
import { runtimeLayer } from "./lib/http.js"
import { sseEvents } from "./lib/sse.js"

const it = testEffect(runtimeLayer(FetchHttpClient.layer))

it.live("native Responses executes a replayed completed HTTP tool only once", () =>
  Effect.gen(function* () {
    const item = { type: "function_call", id: "fc_1", call_id: "call_1", name: "lookup", arguments: "{}" }
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch: () =>
            new Response(
              sseEvents(
                { type: "response.output_item.added", item },
                { type: "response.output_item.done", item },
                { type: "response.output_item.done", item },
                { type: "response.completed", response: { id: "resp_1", output: [item] } },
              ),
              { headers: { "content-type": "text/event-stream" } },
            ),
        }),
      ),
      (server) => Effect.sync(() => server.stop(true)),
    )
    let calls = 0
    const lookup = Tool.make({
      description: "Count executions.",
      parameters: Schema.Struct({}),
      success: Schema.String,
      execute: () => Effect.sync(() => String(++calls)),
    })
    const events = yield* LLMClient.stream(
      LLM.request({
        model: OpenAI.configure({ baseURL: `${server.url}v1`, apiKey: "fixture" }).responses("test"),
        prompt: "Look up.",
      }),
    ).pipe(
      Stream.tap((event) =>
        LLMEvent.is.toolCall(event) ? ToolRuntime.dispatch({ lookup }, event).pipe(Effect.asVoid) : Effect.void,
      ),
      Stream.runCollect,
    )
    expect(calls).toBe(1)
    expect(events.filter(LLMEvent.is.toolCall)).toHaveLength(1)
  }),
)

;["interrupt", "timeout"].forEach((mode) => {
  it.live(`native Responses ${mode} releases a stalled HTTP body`, () =>
    Effect.gen(function* () {
      const ready = yield* Deferred.make<void>()
      const cancelled = Promise.withResolvers<void>()
      const server = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            hostname: "127.0.0.1",
            port: 0,
            fetch: () =>
              new Response(
                new ReadableStream({
                  start(ctrl) {
                    ctrl.enqueue(
                      new TextEncoder().encode(
                        sseEvents(
                          { type: "response.output_item.added", item: { type: "message", id: "msg_1" } },
                          { type: "response.output_text.delta", item_id: "msg_1", delta: "Ready" },
                        ),
                      ),
                    )
                  },
                  cancel() {
                    cancelled.resolve()
                  },
                }),
                { headers: { "content-type": "text/event-stream" } },
              ),
          }),
        ),
        (server) => Effect.sync(() => server.stop(true)),
      )
      const run = yield* LLMClient.stream(
        LLM.request({
          model: OpenAI.configure({ baseURL: `${server.url}v1`, apiKey: "fixture" }).responses("test"),
          prompt: "Wait.",
          http: { chunkTimeout: mode === "timeout" ? 100 : false },
        }),
      ).pipe(
        Stream.tap(() => Deferred.succeed(ready, undefined)),
        Stream.runDrain,
        Effect.forkChild,
      )
      yield* Deferred.await(ready).pipe(Effect.timeout("2 seconds"))
      if (mode === "interrupt") yield* Fiber.interrupt(run)
      const exit = yield* Fiber.await(run).pipe(Effect.timeout("2 seconds"))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        if (mode === "interrupt") expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true)
        if (mode === "timeout")
          expect(Cause.squash(exit.cause)).toMatchObject({ reason: { _tag: "Transport", code: "Timeout" } })
      }
      yield* Effect.promise(() => cancelled.promise).pipe(Effect.timeout("2 seconds"))
    }),
  )
})
