import { expect, test } from "bun:test"
import type { SessionInfo } from "@opencode/client"
import { InputRenderable, TextareaRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode/util/global"
import { createEventStream, createFetch, directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

test.each([40, 100])("TUI goal controls preserve user lifecycle decisions at width %s", async (width) => {
  await using state = await tmpdir()
  const setup = await createTestRenderer({ width, height: 32, useThread: false, kittyKeyboard: true })
  setup.renderer.start()
  const session: SessionInfo = {
    id: `ses_goal_tui_${width}`,
    title: "Goal controls fixture",
    projectID: "project",
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const writes: Record<string, unknown>[] = []
  let stale = false
  const calls = createFetch(async (url, request) => {
    if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
    if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
    if (url.pathname === `/api/session/${session.id}/message`)
      return json({
        data: [{ id: "msg_fixture", type: "user", text: "Goal fixture ready", time: { created: 0 } }],
        cursor: {},
      })
    if (url.pathname === `/api/session/${session.id}/inbox` || url.pathname === `/api/session/${session.id}/permission`)
      return json({ data: [] })
    if (url.pathname !== `/api/session/${session.id}/goal`) return undefined
    const body: Record<string, unknown> = await request.json()
    writes.push(body)
    if (request.method === "POST")
      session.goal = {
        id: "goal-tui",
        revision: 1,
        objective: String(body.objective),
        status: "active",
        rounds: 0,
        maxRounds: 256,
      }
    if (request.method === "PATCH" && session.goal) {
      if (stale) {
        stale = false
        session.goal = { ...session.goal, revision: session.goal.revision + 1, objective: "External goal edit" }
        return json({ message: "Goal changed; refresh before updating." }, { status: 409 })
      }
      expect(body.id).toBe(session.goal.id)
      expect(body.revision).toBe(session.goal.revision)
      if (body.action === "clear") session.goal = undefined
      if (session.goal)
        session.goal = {
          ...session.goal,
          revision: session.goal.revision + 1,
          status:
            body.action === "pause"
              ? "paused"
              : body.action === "resume"
                ? "active"
                : body.action === "complete"
                  ? "complete"
                  : body.action === "block"
                    ? "blocked"
                    : session.goal.status,
          ...(body.objective ? { objective: String(body.objective) } : {}),
          ...(body.maxRounds ? { maxRounds: Number(body.maxRounds) } : {}),
          reason: body.action === "block" ? String(body.reason) : undefined,
        }
    }
    return json(session.goal ?? null)
  }, createEventStream())
  const server = Bun.serve({ port: 0, idleTimeout: 0, fetch: (request) => calls.fetch(request) })
  const { run } = await import("../src/app")
  const task = Effect.runPromise(
    run({
      app: { name: "test", version: "test", channel: "test" },
      server: { endpoint: { url: server.url.toString() } },
      config: {
        get: async () => ({ animations: false, tabs: { mode: "off" }, keybinds: { "session.goal": "f6" } }),
        update: async () => ({}),
      },
      packages: { prepare: async () => ({ directory: "" }) },
      args: { sessionID: session.id },
      terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
      log: () => {},
    }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
  )
  const select = async (title: string) => {
    await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof InputRenderable)
    await setup.mockInput.typeText(title)
    setup.mockInput.pressEnter()
  }
  const replace = async (value: string) => {
    await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable)
    setup.mockInput.pressKey("a", { ctrl: true })
    setup.mockInput.pressKey("k", { ctrl: true })
    await setup.mockInput.typeText(value)
  }
  try {
    await setup.waitForFrame((frame) => frame.includes("Goal fixture ready"))
    expect(writes).toEqual([])
    await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable)
    await setup.mockInput.typeText("/goal")
    await setup.waitForFrame((frame) => frame.includes("/goal"))
    setup.mockInput.pressEnter()
    await setup.waitForFrame((frame) => frame.includes("Set goal"))
    await select("Set goal")
    await setup.waitForFrame((frame) => frame.includes("What should this session"))
    await replace("Finish goal fixture")
    setup.mockInput.pressEnter()
    await setup.waitForFrame((frame) => frame.includes("Pause goal") && frame.includes("Finish goal fixture"))
    expect(writes[0]).toEqual({ objective: "Finish goal fixture" })

    await select("Edit objective")
    await setup.waitForFrame((frame) => frame.includes("Edit goal"))
    await replace("Verify goal fixture")
    setup.mockInput.pressEnter()
    await setup.waitForFrame((frame) => frame.includes("Pause goal") && frame.includes("Verify goal fixture"))
    expect(writes.at(-1)).toEqual({
      id: "goal-tui",
      revision: 1,
      action: "update",
      objective: "Verify goal fixture",
    })

    await select("Change automatic round limit")
    await setup.waitForFrame((frame) => frame.includes("Automatic round limit"))
    await replace("0")
    setup.mockInput.pressEnter()
    await setup.waitForFrame((frame) => frame.includes("positive whole"))
    expect(writes).toHaveLength(2)
    await replace("5")
    setup.mockInput.pressEnter()
    await setup.waitForFrame((frame) => frame.includes("Pause goal") && frame.includes("0/5"))
    expect(writes.at(-1)).toEqual({ id: "goal-tui", revision: 2, action: "update", maxRounds: 5 })

    await select("Pause goal")
    await setup.waitForFrame((frame) => frame.includes("paused"))
    expect(writes.at(-1)?.action).toBe("pause")
    setup.mockInput.pressEscape()
    await setup.waitForFrame((frame) => !frame.includes("Persistent goal"))
    expect(setup.captureCharFrame()).toContain("paused")
    setup.mockInput.pressKey("F6")
    await setup.waitForFrame((frame) => frame.includes("Resume goal"))
    await select("Resume goal")
    await setup.waitForFrame((frame) => frame.includes("active") && frame.includes("Pause goal"))
    expect(writes.at(-1)?.action).toBe("resume")

    await select("Block goal")
    await setup.waitForFrame((frame) => frame.includes("Blocking reason"))
    await replace("Need a review")
    setup.mockInput.pressEnter()
    await setup.waitForFrame((frame) => frame.includes("blocked") && frame.includes("Need a review"))
    expect(writes.at(-1)).toEqual({ id: "goal-tui", revision: 5, action: "block", reason: "Need a review" })
    await select("Resume goal")
    await setup.waitForFrame((frame) => frame.includes("active") && frame.includes("Pause goal"))

    stale = true
    await select("Complete goal")
    await setup.waitForFrame((frame) => frame.includes("Goal changed; refresh") && frame.includes("before updating"))
    expect(session.goal?.status).toBe("active")
    expect(setup.captureCharFrame()).toContain("External goal edit")
    await select("Complete goal")
    await setup.waitForFrame((frame) => frame.includes("complete") && !frame.includes("Resume goal"))
    expect(writes.at(-1)).toEqual({ id: "goal-tui", revision: 8, action: "complete" })
    await select("Clear goal")
    await setup.waitForFrame((frame) => frame.includes("Set goal"))
    expect(writes.at(-1)).toEqual({ id: "goal-tui", revision: 9, action: "clear" })
    expect(writes).toHaveLength(10)
  } finally {
    setup.renderer.destroy()
    await task
    await server.stop(true)
  }
})
