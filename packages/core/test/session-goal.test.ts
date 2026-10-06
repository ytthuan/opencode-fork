import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { ProjectTable } from "@opencode/core/project/sql"
import { GoalTools } from "@opencode/core/tool/plugin/goal"
import { Tool } from "@opencode/core/tool"
import { Form } from "@opencode/core/form"
import { Layer } from "effect"
import { Permission } from "@opencode/core/permission"
import { permissionLayer } from "./lib/permission"
import { registerToolPlugin, toolDefinitions, executeTool, toolIdentity } from "./lib/tool"
import { SessionGoal } from "@opencode/core/session/goal"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionStore } from "@opencode/core/session/store"
import { Project } from "@opencode/schema/project"
import { AbsolutePath } from "@opencode/schema/schema"
import { Session } from "@opencode/schema/session"
import { SessionEvent } from "@opencode/schema/session-event"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionProjector.node,
      SessionStore.node,
      Tool.node,
      Permission.node,
      Form.node,
    ]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      Permission.node.replace(permissionLayer({ assert: () => Effect.void })),
      Form.node.replace(Layer.mock(Form.Service, { ask: () => Effect.succeed({ status: "cancelled" as const }) })),
    ],
  ),
)
const seed = Effect.gen(function* () {
  const database = yield* Database.Service
  const bus = yield* Bus.Service
  const sessionID = Session.ID.create()
  const directory = AbsolutePath.make("/project")
  yield* database.db.insert(ProjectTable).values({ id: Project.ID.global, worktree: directory, sandboxes: [] }).run()
  yield* bus.publish(SessionEvent.Created, {
    sessionID,
    projectID: Project.ID.global,
    location: { directory },
    slug: "goal-test",
    version: "test",
  })
  return { db: database.db, bus, sessionID }
})

describe("persistent session goal", () => {
  it.effect("projects lifecycle, preserves pause on edits and enforces revisions", () =>
    Effect.gen(function* () {
      const s = yield* seed
      expect(yield* SessionGoal.get(s.db, s.sessionID)).toBeNull()
      const created = yield* SessionGoal.create(s.db, s.bus, s.sessionID, {
        objective: "  Ship feature  ",
        maxRounds: 2,
      })
      expect(created.objective).toBe("Ship feature")
      expect(SessionGoal.isArmed(s.sessionID, created)).toBe(true)
      const duplicate = yield* SessionGoal.create(s.db, s.bus, s.sessionID, { objective: "Replace" }).pipe(Effect.exit)
      expect(Exit.isFailure(duplicate)).toBe(true)
      const paused = yield* SessionGoal.update(s.db, s.bus, s.sessionID, {
        id: created.id,
        revision: created.revision,
        action: "pause",
      })
      expect(paused?.status).toBe("paused")
      expect(SessionGoal.isArmed(s.sessionID, created)).toBe(false)
      expect(yield* SessionGoal.nextRound(s.db, s.bus, s.sessionID)).toBe(false)
      const edited = yield* SessionGoal.update(s.db, s.bus, s.sessionID, {
        id: paused!.id,
        revision: paused!.revision,
        action: "update",
        objective: "Finish feature",
      })
      expect(edited?.status).toBe("paused")
      const stale = yield* SessionGoal.update(s.db, s.bus, s.sessionID, {
        id: created.id,
        revision: created.revision,
        action: "resume",
      }).pipe(Effect.exit)
      expect(Exit.isFailure(stale)).toBe(true)
      expect((yield* SessionGoal.get(s.db, s.sessionID))?.status).toBe("paused")
      const resumed = yield* SessionGoal.update(s.db, s.bus, s.sessionID, {
        id: edited!.id,
        revision: edited!.revision,
        action: "resume",
      })
      expect(resumed?.status).toBe("active")
      const store = yield* SessionStore.Service
      expect((yield* store.get(s.sessionID))?.goal).toEqual(resumed ?? undefined)
      const complete = yield* SessionGoal.update(s.db, s.bus, s.sessionID, {
        id: resumed!.id,
        revision: resumed!.revision,
        action: "complete",
      })
      expect(complete?.status).toBe("complete")
      expect(yield* SessionGoal.nextRound(s.db, s.bus, s.sessionID)).toBe(false)
      const replacement = yield* SessionGoal.create(s.db, s.bus, s.sessionID, { objective: "Another goal" })
      expect(replacement.id).not.toBe(created.id)
      const obsolete = yield* SessionGoal.update(s.db, s.bus, s.sessionID, {
        id: created.id,
        revision: replacement.revision,
        action: "pause",
      }).pipe(Effect.exit)
      expect(Exit.isFailure(obsolete)).toBe(true)
      yield* SessionGoal.update(s.db, s.bus, s.sessionID, {
        id: replacement.id,
        revision: replacement.revision,
        action: "clear",
      })
      expect(yield* SessionGoal.get(s.db, s.sessionID)).toBeNull()
    }),
  )

  it.effect("persists goal rounds, stops at the cap, requires explicit resume after disarm", () =>
    Effect.gen(function* () {
      const s = yield* seed
      const created = yield* SessionGoal.create(s.db, s.bus, s.sessionID, { objective: "Keep working", maxRounds: 1 })
      expect(yield* SessionGoal.nextRound(s.db, s.bus, s.sessionID)).toBe(true)
      const current = yield* SessionGoal.get(s.db, s.sessionID)
      expect(current?.rounds).toBe(1)
      const store = yield* SessionStore.Service
      expect((yield* store.messages({ sessionID: s.sessionID })).at(-1)?.type).toBe("synthetic")
      expect(yield* SessionGoal.nextRound(s.db, s.bus, s.sessionID)).toBe(false)
      const blocked = yield* SessionGoal.get(s.db, s.sessionID)
      expect(blocked?.status).toBe("blocked")
      expect(blocked?.reason).toContain("limit")
      const exhausted = yield* SessionGoal.update(s.db, s.bus, s.sessionID, {
        id: blocked!.id,
        revision: blocked!.revision,
        action: "resume",
      }).pipe(Effect.exit)
      expect(Exit.isFailure(exhausted)).toBe(true)
      const resumed = yield* SessionGoal.update(s.db, s.bus, s.sessionID, {
        id: blocked!.id,
        revision: blocked!.revision,
        action: "resume",
        maxRounds: 2,
      })
      SessionGoal.disarm(s.sessionID)
      expect(yield* SessionGoal.nextRound(s.db, s.bus, s.sessionID)).toBe(false)
      expect((yield* SessionGoal.get(s.db, s.sessionID))?.status).toBe("active")
      expect(resumed?.id).toBe(created.id)
    }),
  )

  it.effect("serializes competing creates and mutations without losing the winner", () =>
    Effect.gen(function* () {
      const s = yield* seed
      const creates = yield* Effect.all(
        [
          SessionGoal.create(s.db, s.bus, s.sessionID, { objective: "First" }).pipe(Effect.exit),
          SessionGoal.create(s.db, s.bus, s.sessionID, { objective: "Second" }).pipe(Effect.exit),
        ],
        { concurrency: "unbounded" },
      )
      expect(creates.filter(Exit.isSuccess)).toHaveLength(1)
      const current = yield* SessionGoal.get(s.db, s.sessionID)
      const changes = yield* Effect.all(
        [
          SessionGoal.update(s.db, s.bus, s.sessionID, {
            id: current!.id,
            revision: current!.revision,
            action: "pause",
          }).pipe(Effect.exit),
          SessionGoal.update(s.db, s.bus, s.sessionID, {
            id: current!.id,
            revision: current!.revision,
            action: "complete",
          }).pipe(Effect.exit),
        ],
        { concurrency: "unbounded" },
      )
      expect(changes.filter(Exit.isSuccess)).toHaveLength(1)
      expect((yield* SessionGoal.get(s.db, s.sessionID))?.revision).toBe(current!.revision + 1)
    }),
  )
})

test("goal transition rejects blank objectives, missing blockers, and completed resume", () => {
  const goal = { id: "goal", objective: "Work", revision: 1, status: "active" as const, rounds: 0, maxRounds: 1 }
  expect(() => SessionGoal.transition(goal, { id: goal.id, revision: 1, action: "update", objective: " " })).toThrow(
    "blank",
  )
  expect(() => SessionGoal.transition(goal, { id: goal.id, revision: 1, action: "block" })).toThrow("reason")
  expect(() =>
    SessionGoal.transition({ ...goal, status: "complete" }, { id: goal.id, revision: 1, action: "resume" }),
  ).toThrow("Completed")
})

it.effect("advertises native goal tools, validates model input, and uses current-session persistence", () =>
  Effect.gen(function* () {
    const s = yield* seed
    const created = yield* SessionGoal.create(s.db, s.bus, s.sessionID, { objective: "Ship" })
    yield* registerToolPlugin(GoalTools.Plugin, {
      session: {
        goal: (input) => SessionGoal.get(s.db, input.sessionID),
        updateGoal: (input) => SessionGoal.update(s.db, s.bus, input.sessionID, input),
      },
    })
    const tools = yield* Tool.Service
    yield* tools.transform((editor) => {
      editor.update("opencode_goal_get", (tool) => {
        tool.options = { namespace: "opencode", codemode: false }
      })
      editor.update("opencode_goal_update", (tool) => {
        tool.options = { namespace: "opencode", codemode: false }
      })
    })
    const definitions = yield* toolDefinitions(tools)
    expect(definitions.map((item) => item.name)).toContain("opencode_goal_get")
    expect(definitions.map((item) => item.name)).toContain("opencode_goal_update")
    const read = yield* executeTool(tools, {
      sessionID: s.sessionID,
      ...toolIdentity,
      call: { type: "tool-call", id: "read", name: "opencode_goal_get", input: {} },
    })
    expect(read.output).toMatchObject({ objective: "Ship", status: "active" })
    const forbidden = yield* executeTool(tools, {
      sessionID: s.sessionID,
      ...toolIdentity,
      call: {
        type: "tool-call",
        id: "resume",
        name: "opencode_goal_update",
        input: { id: created.id, revision: created.revision, action: "resume" },
      },
    })
    expect(forbidden.status).toBe("error")
    const deniedPause = yield* executeTool(tools, {
      sessionID: s.sessionID,
      ...toolIdentity,
      call: {
        type: "tool-call",
        id: "pause",
        name: "opencode_goal_update",
        input: { id: created.id, revision: created.revision, action: "pause" },
      },
    })
    expect(deniedPause.status).toBe("error")
    expect((yield* SessionGoal.get(s.db, s.sessionID))?.status).toBe("active")
    const completed = yield* executeTool(tools, {
      sessionID: s.sessionID,
      ...toolIdentity,
      call: {
        type: "tool-call",
        id: "complete",
        name: "opencode_goal_update",
        input: { id: created.id, revision: created.revision, action: "complete" },
      },
    })
    expect(completed.output).toMatchObject({ status: "complete" })
    expect((yield* SessionGoal.get(s.db, s.sessionID))?.status).toBe("complete")
  }),
)
