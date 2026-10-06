import { expect, test } from "bun:test"
import { SessionGoal } from "@opencode/schema/session-goal"
import { Schema } from "effect"
import { fileURLToPath } from "node:url"
import { OPENCODE_VERSION } from "../src/version"

test("CLI goal controls parse user flags and send the current goal identity and revision", async () => {
  const created = {
    id: "goal-cli",
    revision: 1,
    objective: "Ship CLI goal",
    status: "active" as const,
    rounds: 0,
    maxRounds: 3,
  }
  const replies: Array<SessionGoal.Info | null> = [
    created,
    { ...created, revision: 2, status: "paused" },
    { ...created, revision: 3, status: "paused", objective: "Verify CLI goal", maxRounds: 4 },
    { ...created, revision: 4, objective: "Verify CLI goal", maxRounds: 4 },
    {
      ...created,
      revision: 5,
      status: "blocked",
      objective: "Verify CLI goal",
      maxRounds: 4,
      reason: "Need user review",
    },
    { ...created, revision: 6, status: "complete", objective: "Verify CLI goal", maxRounds: 4 },
    null,
  ]
  let current: SessionGoal.Info | null = null
  const writes: Array<{ method: string; body: Record<string, unknown> }> = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url)
      if (url.pathname === "/api/info")
        return Response.json({ version: OPENCODE_VERSION, pid: process.pid, urls: [], paths: { tmp: import.meta.dir } })
      if (url.pathname !== "/api/session/ses_cli_goal/goal") return new Response("Not found", { status: 404 })
      if (request.method === "GET") return Response.json(current)
      writes.push({ method: request.method, body: await request.json() })
      current = replies.shift() ?? null
      return Response.json(current)
    },
  })
  const run = async (args: string[]) => {
    const child = Bun.spawn(
      [
        process.execPath,
        "run",
        "src/index.ts",
        "session",
        "goal",
        "ses_cli_goal",
        ...args,
        "--server",
        server.url.origin,
      ],
      { cwd: fileURLToPath(new URL("..", import.meta.url)), stdout: "pipe", stderr: "pipe" },
    )
    const [status, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(status, stderr).toBe(0)
    return Schema.decodeUnknownSync(Schema.NullOr(SessionGoal.Info))(JSON.parse(stdout))
  }
  try {
    expect(await run([])).toBeNull()
    expect(writes).toEqual([])
    expect(await run(["--action", "create", "--objective", "Ship CLI goal", "--max-rounds", "3"])).toEqual(created)
    expect(await run(["--action", "pause"])).toMatchObject({ revision: 2, status: "paused" })
    expect(await run(["--action", "update", "--objective", "Verify CLI goal", "--max-rounds", "4"])).toMatchObject({
      revision: 3,
      status: "paused",
      objective: "Verify CLI goal",
      maxRounds: 4,
    })
    expect(await run(["--action", "resume"])).toMatchObject({ revision: 4, status: "active" })
    expect(await run(["--action", "block", "--reason", "Need user review"])).toMatchObject({
      revision: 5,
      status: "blocked",
      reason: "Need user review",
    })
    expect(await run(["--action", "complete"])).toMatchObject({ revision: 6, status: "complete" })
    expect(await run(["--action", "clear"])).toBeNull()
    expect(writes).toEqual([
      { method: "POST", body: { objective: "Ship CLI goal", maxRounds: 3 } },
      { method: "PATCH", body: { id: created.id, revision: 1, action: "pause" } },
      {
        method: "PATCH",
        body: { id: created.id, revision: 2, action: "update", objective: "Verify CLI goal", maxRounds: 4 },
      },
      { method: "PATCH", body: { id: created.id, revision: 3, action: "resume" } },
      { method: "PATCH", body: { id: created.id, revision: 4, action: "block", reason: "Need user review" } },
      { method: "PATCH", body: { id: created.id, revision: 5, action: "complete" } },
      { method: "PATCH", body: { id: created.id, revision: 6, action: "clear" } },
    ])
  } finally {
    await server.stop(true)
  }
}, 60_000)
