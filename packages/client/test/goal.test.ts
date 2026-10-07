import { expect, test } from "bun:test"
import { Effect } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { OpenCode } from "../src/promise"

const goal = { id: "goal-http", revision: 1, objective: "Ship", status: "active" as const, rounds: 0, maxRounds: 3 }

test("promise goal controls preserve goal identity, revision, and mutations on the wire", async () => {
  const requests: Request[] = []
  const client = OpenCode.make({
    baseUrl: "http://goal.test",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      requests.push(request)
      return Response.json(request.method === "PATCH" ? { ...goal, revision: 2, status: "paused" } : goal)
    },
  })
  expect(await client.session.goal({ sessionID: "ses_goal" })).toEqual(goal)
  await client.session.createGoal({ sessionID: "ses_goal", objective: "Ship", maxRounds: 3 })
  expect(
    await client.session.updateGoal({ sessionID: "ses_goal", id: goal.id, revision: 1, action: "pause" }),
  ).toMatchObject({ status: "paused" })
  expect(requests.map((request) => [request.method, new URL(request.url).pathname])).toEqual([
    ["GET", "/api/session/ses_goal/goal"],
    ["POST", "/api/session/ses_goal/goal"],
    ["PATCH", "/api/session/ses_goal/goal"],
  ])
  expect(await requests[2].json()).toEqual({ id: goal.id, revision: 1, action: "pause" })
})

test("Effect goal controls decode the native contract", async () => {
  const httpClient = HttpClient.make((request) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(goal))),
  )
  const network = await import("../src/effect")
  const result = await Effect.gen(function* () {
    const client = yield* network.OpenCode.make({ baseUrl: "http://goal.test" })
    return yield* client.session.goal({ sessionID: "ses_goal" })
  }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient), Effect.runPromise)
  expect(result).toEqual(goal)
})
