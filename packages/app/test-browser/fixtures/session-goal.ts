import { expect, mock, test } from "bun:test"
import { createRequire } from "node:module"
import { OpenCode, type SessionInfo } from "@opencode/client/promise"
import { SessionGoal } from "@opencode/schema/session-goal"
import { Schema } from "effect"
import { createComponent } from "solid-js"
import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import en from "@/runtime/i18n/en"

const require = createRequire(import.meta.url)

const solid = createRequire(require.resolve("vite-plugin-solid"))

const { transformSync } = solid("@babel/core")

// Compile production JSX with Vite's Solid presets; Happy DOM runs without a browser process.
Bun.plugin({
  name: "goal-solid-components",
  setup(build) {
    build.onLoad({ filter: /[\\/]src[\\/].*\.tsx$/ }, async (args) => ({
      contents: transformSync(await Bun.file(args.path).text(), {
        filename: args.path,
        presets: [solid.resolve("babel-preset-solid"), solid.resolve("@babel/preset-typescript")],
      }).code,
      loader: "js",
    }))
  },
})

const initial: SessionInfo = {
  id: "ses_app_goal",
  title: "Goal bar fixture",
  projectID: "project",
  location: { directory: "/goal-fixture" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
}

const [state, setState] = createStore({ session: initial })

const writes: Array<{ method: string; path: string; body: SessionGoal.Create | SessionGoal.Update }> = []

const goal = {
  id: "goal-app",
  revision: 1,
  objective: "Verify app controls",
  status: "active" as const,
  rounds: 0,
  maxRounds: 3,
}

const replies: Array<SessionInfo["goal"] | null> = [
  goal,
  { ...goal, revision: 2, status: "paused" },
  { ...goal, revision: 3, status: "paused", objective: "Review app controls", maxRounds: 5 },
  { ...goal, revision: 4, objective: "Review app controls", maxRounds: 5 },
  { ...goal, revision: 5, status: "complete", objective: "Review app controls", maxRounds: 5 },
  null,
]

const api = OpenCode.make({
  baseUrl: "http://goal.test",
  fetch: async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const body = await request.json()

    writes.push({
      method: request.method,
      path: new URL(request.url).pathname,
      body:
        request.method === "POST"
          ? Schema.decodeUnknownSync(SessionGoal.Create)(body)
          : Schema.decodeUnknownSync(SessionGoal.Update)(body),
    })
    const reply = replies.shift()
    setState("session", "goal", reply ?? undefined)

    return Response.json(reply ?? null)
  },
})

mock.module("@/runtime/server/client", () => ({ useServerSDK: () => ({ api }) }))

mock.module("@/runtime/i18n/language", () => ({
  useLanguage: () => ({ t: (key: keyof typeof en) => en[key] }),
}))

const { SessionGoalBar } = await import("@/session/goal-bar")

const wait = async (predicate: () => boolean) => {
  for (const _ of Array.from({ length: 100 })) {
    if (predicate()) return
    await Bun.sleep(10)
  }

  throw new Error("Goal bar did not settle")
}

test("renders authoritative goal changes and sends explicit create, edit and lifecycle requests", async () => {
  const host = document.createElement("div")
  document.body.append(host)

  const dispose = render(
    () =>
      createComponent(SessionGoalBar, {
        get session() {
          return state.session
        },
      }),
    host,
  )

  const click = (label: string) => {
    const button = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === label)
    expect(button).toBeDefined()
    button?.click()
  }

  const value = (selector: "textarea" | "input", text: string) => {
    const input = host.querySelector<HTMLTextAreaElement | HTMLInputElement>(selector)
    expect(input).not.toBeNull()

    if (!input) return
    input.value = text
    input.dispatchEvent(new InputEvent("input", { bubbles: true }))
  }

  const submit = () =>
    host.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))

  try {
    expect(writes).toEqual([])
    click("Set goal")
    value("textarea", "Verify app controls")
    value("input", "3")
    submit()
    await wait(() => writes.length === 1 && !host.querySelector("form"))
    expect(writes[0]).toEqual({
      method: "POST",
      path: "/api/session/ses_app_goal/goal",
      body: { objective: "Verify app controls", maxRounds: 3 },
    })
    expect(host.textContent).toContain("Active · 0/3")

    click("Pause goal")
    await wait(() => writes.length === 2 && !host.querySelector("button[disabled]"))
    expect(host.textContent).toContain("Paused · 0/3")
    click("Edit goal")
    value("textarea", "Review app controls")
    value("input", "5")
    submit()
    await wait(() => writes.length === 3 && !host.querySelector("form"))
    expect(writes[2]?.body).toEqual({
      id: goal.id,
      revision: 2,
      action: "update",
      objective: "Review app controls",
      maxRounds: 5,
    })
    expect(host.textContent).toContain("Paused · 0/5")

    click("Resume goal")
    await wait(() => writes.length === 4 && !host.querySelector("button[disabled]"))
    expect(host.textContent).toContain("Active · 0/5")
    click("Complete goal")
    await wait(() => writes.length === 5 && !host.querySelector("button[disabled]"))
    expect(host.textContent).toContain("Complete · 0/5")
    expect(host.textContent).not.toContain("Resume goal")
    click("Clear goal")
    await wait(() => writes.length === 6 && host.textContent?.includes("Set goal") === true)
    expect(
      writes
        .slice(1)
        .map((write) => [
          write.method,
          write.path,
          "action" in write.body ? write.body.action : undefined,
          "id" in write.body ? write.body.id : undefined,
          "revision" in write.body ? write.body.revision : undefined,
        ]),
    ).toEqual([
      ["PATCH", "/api/session/ses_app_goal/goal", "pause", goal.id, 1],
      ["PATCH", "/api/session/ses_app_goal/goal", "update", goal.id, 2],
      ["PATCH", "/api/session/ses_app_goal/goal", "resume", goal.id, 3],
      ["PATCH", "/api/session/ses_app_goal/goal", "complete", goal.id, 4],
      ["PATCH", "/api/session/ses_app_goal/goal", "clear", goal.id, 5],
    ])
  } finally {
    dispose()
    host.remove()
  }
})
