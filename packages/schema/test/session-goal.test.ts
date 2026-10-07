import { expect, test } from "bun:test"
import { Schema } from "effect"
import { SessionGoal } from "../src/session-goal.js"
import { SessionEvent } from "../src/session-event.js"
import { EventManifest } from "../src/event-manifest.js"

test("goal contracts reject invalid boundaries and omit undefined optionals", () => {
  const decode = Schema.decodeUnknownSync(SessionGoal.Create)
  expect(() => decode({ objective: "" })).toThrow()
  expect(() => decode({ objective: "x", maxRounds: 0 })).toThrow()
  expect(() => decode({ objective: "x", maxRounds: 1.5 })).toThrow()
  expect(Schema.encodeSync(SessionGoal.Create)({ objective: "x", maxRounds: undefined })).toEqual({ objective: "x" })
  expect(
    Schema.encodeSync(SessionGoal.Info)({
      id: "g",
      revision: 1,
      objective: "x",
      status: "active",
      rounds: 0,
      maxRounds: 1,
      reason: undefined,
    }),
  ).not.toHaveProperty("reason")
  expect(EventManifest.Durable.has("session.goal.changed.1")).toBe(true)
  expect(EventManifest.Server.get("session.goal.changed")).toBe(SessionEvent.GoalChanged)
})
