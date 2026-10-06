import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { tmpdir } from "./fixture/tmpdir"
import { Provider } from "@opencode/core/provider"

describe("Provider", () => {
  test("compiled bundles load all custom provider entrypoints without installed packages", async () => {
    await using dir = await tmpdir()
    const entry = path.join(dir.path, "entry.ts")
    await Bun.write(
      entry,
      `import { Effect } from ${JSON.stringify(fileURLToPath(import.meta.resolve("effect")))}
import { Provider } from ${JSON.stringify(fileURLToPath(import.meta.resolve("@opencode/core/provider")))}
for (const specifier of ["@opencode/ai/providers/openai-compatible", "@opencode/ai/providers/openai-compatible/responses", "@opencode/ai/providers/openai-compatible-responses", "@opencode/ai/providers/anthropic-compatible"]) {
  const module = await Effect.runPromise(Provider.loadPackage(specifier))
  const model = module.model("test", { baseURL: "http://127.0.0.1:4000/v1", apiKey: "fixture" })
  console.log(model.route.endpoint.baseURL)
}
`,
    )
    const result = await Bun.build({
      entrypoints: [entry],
      target: "bun",
      compile: { outfile: path.join(dir.path, "provider") },
      throw: false,
    })
    expect(result.logs).toEqual([])
    expect(result.success).toBe(true)
    const child = Bun.spawn([path.join(dir.path, "provider")], {
      cwd: dir.path,
      env: { ...process.env, NODE_PATH: "" },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(stderr).toBe("")
    expect(code).toBe(0)
    expect(stdout.trim().split("\n")).toEqual(Array(4).fill("http://127.0.0.1:4000/v1"))
  }, 30_000)

  test("loads bundled native provider entrypoints", async () => {
    const packages = [
      "@opencode/ai/providers/baseten",
      "@opencode/ai/providers/cerebras",
      "@opencode/ai/providers/cloudflare-ai-gateway",
      "@opencode/ai/providers/cloudflare-workers-ai",
      "@opencode/ai/providers/cohere",
      "@opencode/ai/providers/cohere/chat",
      "@opencode/ai/providers/deepinfra",
      "@opencode/ai/providers/deepseek",
      "@opencode/ai/providers/fireworks",
      "@opencode/ai/providers/google-vertex",
      "@opencode/ai/providers/google-vertex/gemini",
      "@opencode/ai/providers/google-vertex/chat",
      "@opencode/ai/providers/google-vertex/responses",
      "@opencode/ai/providers/google-vertex/messages",
      "@opencode/ai/providers/groq",
      "@opencode/ai/providers/mistral",
      "@opencode/ai/providers/togetherai",
      "@opencode/ai/providers/vercel-ai-gateway",
    ]

    for (const specifier of packages) {
      const loaded = await Effect.runPromise(Provider.loadPackage(specifier))
      expect(loaded.model).toBeFunction()
    }
  })

  test("passes flat settings to native packages without Core settings", () => {
    expect(
      Provider.nativeSettings({
        apiKey: "secret",
        reasoningEffort: "high",
        chunkTimeout: 1000,
        compaction: { type: "native" },
        transport: "websocket",
      }),
    ).toEqual({
      apiKey: "secret",
      reasoningEffort: "high",
    })
  })

  test("inherits shared and loose settings without provider-only policies", () => {
    expect(
      Provider.modelSettings({
        timeout: 60_000,
        chunkTimeout: 30_000,
        transport: "websocket",
        compaction: { type: "native" },
        reasoningEffort: "high",
      }),
    ).toEqual({
      compaction: { type: "native" },
      reasoningEffort: "high",
    })
  })
})
