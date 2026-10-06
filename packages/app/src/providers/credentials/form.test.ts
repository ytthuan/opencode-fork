import { describe, expect, test } from "bun:test"
import { Config } from "@opencode/schema/config"
import type { ConfigEntry } from "@opencode/client/promise"
import { Schema } from "effect"
import {
  configuredProviders,
  efforts,
  headerRow,
  modelRow,
  packages,
  providerForm,
  validateCustomProvider,
  wires,
} from "./form"

const t = (key: string) => key

const validate = (form: ReturnType<typeof providerForm>, editing?: string) =>
  validateCustomProvider({ form, t, editing, existingProviderIDs: new Set(["existing"]) })

const form = () => ({
  ...providerForm(),
  providerID: "custom-provider",
  name: " Custom Provider ",
  baseURL: " https://api.example.com/v1/ ",
  models: [modelRow("model-a")],
})

describe("validateCustomProvider", () => {
  test("builds native v2 config for mixed API formats and per-model limits", () => {
    const input = form()
    input.apiKey = " {env: CUSTOM_PROVIDER_KEY} "
    input.headers = [headerRow(" X-Test ", " enabled "), headerRow()]
    input.models = wires.map((wire) => ({
      ...modelRow(` ${wire} `),
      name: ` ${wire} model `,
      model: ` remote-${wire} `,
      wire,
      baseURL: ` https://${wire}.example.com/v1/ `,
      context: "272000",
      input: "200000",
      output: "128000",
      efforts: [...efforts],
    }))
    const result = validate(input).result
    expect(result).toBeDefined()
    const config = Schema.decodeUnknownSync(Config.Info)({ providers: { custom: result!.config } }).providers!.custom!
    expect(result!.key).toBeUndefined()
    expect(config).toMatchObject({
      name: "Custom Provider",
      package: packages.chat,
      env: ["CUSTOM_PROVIDER_KEY"],
      settings: { baseURL: "https://api.example.com/v1" },
      headers: { "X-Test": "enabled" },
    })
    wires.forEach((wire) => {
      const model = config.models![wire]
      expect(model).toMatchObject({
        name: `${wire} model`,
        modelID: `remote-${wire}`,
        package: packages[wire],
        settings: { baseURL: `https://${wire}.example.com/v1` },
        limit: { context: 272000, input: 200000, output: 128000 },
        variants_mode: "replace",
      })
      expect(model.variants!.map((variant) => String(variant.id))).toEqual([...efforts])
    })
    expect(config.models!.messages.variants![0].settings).toEqual({ thinking: { type: "disabled" } })
    expect(config.models!.messages.variants![3].settings).toEqual({ thinking: { type: "adaptive" }, effort: "medium" })
    expect(config.models!.responses.variants![3].settings).toMatchObject({
      reasoningEffort: "medium",
      include: ["reasoning.encrypted_content"],
    })
    expect(config.models!.chat.variants![3].settings).toEqual({ reasoningEffort: "medium" })
  })

  test("preserves advanced configuration and credentials when editing and adding models", () => {
    const source = {
      name: "Existing",
      package: packages.responses,
      env: ["EXISTING_KEY"],
      settings: { baseURL: "http://localhost:4000/v1", timeout: 90000 },
      body: { store: false },
      headers: { "X-Org": "example" },
      models: {
        first: {
          name: "First",
          modelID: "remote-first",
          capabilities: { tools: false, input: ["text", "image"] },
          compatibility: { supportsPromptCacheKey: true },
          settings: { temperature: 0.2 },
          body: { custom: true },
          limit: { context: 100000, input: 80000, output: 16000 },
          variants: [
            { id: "low", settings: { reasoningEffort: "low", temperature: 0.1 }, headers: { "X-Mode": "low" } },
            { id: "custom", body: { style: "concise" } },
          ],
        },
      },
    }

    const input = providerForm("existing", source)
    expect(input.wire).toBe("responses")
    expect(input.models[0].efforts).toEqual(["low"])
    input.models[0].efforts = ["low", "high"]
    input.models.push(modelRow("second"))
    const result = validate(input, "existing").result!
    expect(result.key).toBeUndefined()
    expect(result.config).toMatchObject({
      env: ["EXISTING_KEY"],
      settings: source.settings,
      headers: source.headers,
      body: source.body,
      models: {
        first: {
          modelID: "remote-first",
          capabilities: source.models.first.capabilities,
          compatibility: source.models.first.compatibility,
          body: source.models.first.body,
          limit: source.models.first.limit,
        },
        second: { name: "second" },
      },
    })
    expect(result.config.models!.first.variants).toContainEqual({ id: "custom", body: { style: "concise" } })
    expect(result.config.models!.first.variants!.find((variant) => variant.id === "low")).toMatchObject({
      headers: { "X-Mode": "low" },
      settings: { temperature: 0.1, reasoningEffort: "low" },
    })
    input.models[0].efforts = []
    input.models.splice(1)
    const saved = validate(input, "existing").result!
    expect(saved.config.models!.first.variants).toEqual([{ id: "custom", body: { style: "concise" } }])
    expect(saved.config.models).not.toHaveProperty("second")
    input.models = [modelRow("replacement")]
    const removed = validate(input, "existing").result!.config
    expect(removed.models?.first.disabled).toBe(true)
    expect(providerForm("existing", removed).models.map((model) => model.id)).toEqual(["replacement"])
  })

  test("preserves existing adapters and effort settings until their format changes", () => {
    const source = {
      name: "Existing",
      package: "@opencode/ai/providers/anthropic",
      settings: { baseURL: "https://api.example.com/v1", apiKey: "{env:EXISTING_KEY}" },
      headers: { Authorization: "Bearer {env:EXISTING_KEY}" },
      models: {
        model: {
          name: "Model",
          package: "@opencode/ai/providers/anthropic",
          variants: [
            { id: "high", settings: { thinking: { type: "enabled", budgetTokens: 12000 }, effort: "medium" } },
          ],
        },
      },
    }

    const input = providerForm("existing", source)
    const saved = validate(input, "existing").result!.config
    expect(saved.package).toBe(source.package)
    expect(saved.settings).toEqual(source.settings)
    expect(saved.headers).toEqual(source.headers)
    expect(saved.models?.model.package).toBe(source.models.model.package)
    expect(saved.models?.model.variants).toEqual(source.models.model.variants)
    input.models[0].efforts.push("max")
    const added = validate(input, "existing").result!.config.models!.model.variants!
    expect(added[0]).toEqual(source.models.model.variants[0])
    expect(added[1]).toMatchObject({ id: "max", settings: { thinking: { type: "adaptive" }, effort: "max" } })
    input.models[0].wire = "responses"
    const switched = validate(input, "existing").result!.config
    expect(switched.package).toBe(source.package)
    expect(switched.models?.model.package).toBe(packages.responses)
    expect(switched.models?.model.variants?.[0].settings).toEqual({
      reasoningEffort: "high",
      reasoningSummary: "auto",
      include: ["reasoning.encrypted_content"],
    })
    input.wire = "chat"
    expect(validate(input, "existing").result?.config.package).toBe(packages.chat)
  })

  test("edits reference sources without persisting resolved credentials", () => {
    const source = {
      name: "Existing",
      package: packages.responses,
      settings: { baseURL: "{env:PROVIDER_URL}", apiKey: "{env:PROVIDER_KEY}" },
      headers: { Authorization: "Bearer {file:token.txt}" },
      models: { model: { name: "Model", settings: { baseURL: "{env:MODEL_URL}" } } },
    }

    const configured = configuredProviders([
      {
        type: "document",
        info: {
          providers: {
            existing: {
              ...source,
              settings: { baseURL: "https://api.example.com/v1", apiKey: "synthetic-resolved-secret" },
              headers: { Authorization: "Bearer synthetic-file-secret" },
            },
          },
        },
        source: { providers: { existing: source } },
      },
    ])

    const input = providerForm("existing", configured.existing)
    const saved = validate(input, "existing").result!.config
    expect(saved.settings).toEqual(source.settings)
    expect(saved.headers).toEqual(source.headers)
    expect(saved.models?.model.settings).toEqual(source.models.model.settings)
    expect(JSON.stringify(saved)).not.toContain("synthetic-")
    input.baseURL = "https://changed.example.com/v1"
    expect(validate(input, "existing").result?.config.settings?.baseURL).toBe(input.baseURL)
  })

  test("does not expose lower provider definitions when an overlay cannot preserve its source", () => {
    const configured = configuredProviders([
      { type: "document", info: { providers: { existing: { name: "Lower", models: { first: {} } } } } },
      {
        type: "document",
        info: {
          providers: {
            existing: { name: "Active", models: { first: { settings: { compaction: { type: "summary" } } } } },
          },
        },
        source: {},
      },
    ])

    expect(configured).not.toHaveProperty("existing")
  })

  test("rejects duplicate models and headers and permits the provider being edited", () => {
    const input = form()
    input.providerID = "existing"
    input.models.push(modelRow("model-a"))
    input.headers = [headerRow("Authorization", "one"), headerRow("authorization", "two")]
    const result = validate(input, "existing")
    expect(result.result).toBeUndefined()
    expect(result.err.providerID).toBeUndefined()
    expect(result.models[1].id).toBe("provider.custom.error.duplicate")
    expect(result.headers[1].key).toBe("provider.custom.error.duplicate")
    expect(validate(input).err.providerID).toBe("provider.custom.error.providerID.exists")
  })

  test("rejects invalid limits and endpoint URLs while allowing inherited limits", () => {
    const input = form()

    ;["0", "-1", "1.5", "Infinity", "9007199254740992", "abc"].forEach((value) => {
      input.models[0].input = value
      expect(validate(input).models[0].input).toBe("provider.custom.error.tokens")
    })
    input.models[0].context = "1000"
    input.models[0].input = "1001"
    input.models[0].output = "1002"
    expect(validate(input).models[0]).toMatchObject({
      input: "provider.custom.error.context",
      output: "provider.custom.error.context",
    })
    input.models[0].input = ""
    input.models[0].output = ""
    expect(validate(input).result).toBeDefined()
    input.models[0].baseURL = "https://api.example.com/v1?key=secret"
    expect(validate(input).models[0].baseURL).toBe("provider.custom.error.baseURL.format")
    input.models[0].baseURL = ""
    input.baseURL = "file:///private/key"
    expect(validate(input).err.baseURL).toBe("provider.custom.error.baseURL.format")
  })

  test("reads global provider models together without copying workspace configuration", () => {
    const entries: ConfigEntry[] = [
      {
        type: "document",
        info: {
          providers: {
            custom: {
              name: "Old",
              models: {
                first: {
                  name: "First",
                  settings: { temperature: 0.2, vendor: { one: true } },
                  limit: { context: 128000, input: 96000 },
                  variants: [{ id: "low", settings: { temperature: 0.1, reasoningEffort: "low" } }],
                },
              },
            },
          },
        },
      },
      {
        type: "document",
        info: {
          providers: {
            custom: {
              name: "New",
              models: {
                first: {
                  name: "Updated",
                  settings: { vendor: { two: true } },
                  limit: { output: 16000 },
                  variants: [{ id: "low", settings: { reasoningEffort: "medium" } }],
                },
                second: { name: "Second" },
              },
            },
          },
        },
      },
      { type: "directory", path: "/tmp/global" },
      {
        type: "document",
        info: { providers: { custom: { name: "Workspace", models: { local: { name: "Local" } } } } },
      },
    ]

    expect(configuredProviders(entries).custom).toMatchObject({
      name: "New",
      models: {
        first: {
          name: "Updated",
          settings: { temperature: 0.2, vendor: { one: true, two: true } },
          limit: { context: 128000, input: 96000, output: 16000 },
          variants: [{ id: "low", settings: { temperature: 0.1, reasoningEffort: "medium" } }],
        },
        second: { name: "Second" },
      },
    })
    expect(configuredProviders(entries).custom.models).not.toHaveProperty("local")
  })
})
