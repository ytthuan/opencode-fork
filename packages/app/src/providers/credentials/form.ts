import type { ConfigUpdateInput } from "@opencode/client/promise"
import { mergeDeep } from "remeda"
import { Option, Schema } from "effect"

const PROVIDER_ID = /^[a-z0-9][a-z0-9-_]*$/

export const wires = ["chat", "responses", "messages"] as const

export type Wire = (typeof wires)[number]

export const efforts = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const

export type Effort = (typeof efforts)[number]

export const packages = {
  chat: "@opencode/ai/providers/openai-compatible",
  responses: "@opencode/ai/providers/openai-compatible/responses",
  messages: "@opencode/ai/providers/anthropic-compatible",
}

type Translator = (key: string, vars?: Record<string, string | number | boolean>) => string

export type Provider = NonNullable<NonNullable<ConfigUpdateInput["providers"]>[string]>

type Model = NonNullable<Provider["models"]>[string]

type Variant = NonNullable<Model["variants"]>[number]

export type ModelErr = {
  id?: string
  name?: string
  baseURL?: string
  context?: string
  input?: string
  output?: string
}

export type HeaderErr = {
  key?: string
  value?: string
}

export type ModelRow = {
  row: string
  id: string
  name: string
  model: string
  wire: Wire | ""
  baseURL: string
  context: string
  input: string
  output: string
  efforts: Effort[]
  source?: Model
  err: ModelErr
}

export type HeaderRow = {
  row: string
  key: string
  value: string
  err: HeaderErr
}

export type FormState = {
  providerID: string
  name: string
  baseURL: string
  wire: Wire
  apiKey: string
  models: ModelRow[]
  headers: HeaderRow[]
  source?: Provider
  err: {
    providerID?: string
    name?: string
    baseURL?: string
  }
}

const wire = (value?: string): Wire => {
  if (value?.includes("responses")) return "responses"

  if (value?.includes("anthropic") || value?.endsWith("messages")) return "messages"

  return "chat"
}

const url = (value: string) => {
  const parsed = URL.parse(value)

  return !!parsed && ["http:", "https:"].includes(parsed.protocol) && !parsed.hash && !parsed.search
}

const tokens = (value: string) => !value.trim() || (Number.isSafeInteger(Number(value)) && Number(value) > 0)

export function validateCustomProvider(input: {
  form: FormState
  t: Translator
  existingProviderIDs: Set<string>
  editing?: string
}) {
  const form = input.form
  const id = form.providerID.trim()
  const name = form.name.trim()
  const endpoint = form.baseURL.trim().replace(/\/+$/, "")
  const secret = form.apiKey.trim()
  const env = secret.match(/^\{env:([^}]+)\}$/)?.[1]?.trim()

  const err = {
    providerID: !id
      ? input.t("provider.custom.error.providerID.required")
      : !PROVIDER_ID.test(id)
        ? input.t("provider.custom.error.providerID.format")
        : input.existingProviderIDs.has(id) && input.editing !== id
          ? input.t("provider.custom.error.providerID.exists")
          : undefined,
    name: !name ? input.t("provider.custom.error.name.required") : undefined,
    baseURL: !endpoint
      ? input.t("provider.custom.error.baseURL.required")
      : !url(endpoint) && endpoint !== form.source?.settings?.baseURL
        ? input.t("provider.custom.error.baseURL.format")
        : undefined,
  }

  const seen = new Set<string>()

  const models = form.models.map((item) => {
    const id = item.id.trim()
    const duplicate = seen.has(id)
    seen.add(id)

    const limit = (key: "context" | "input" | "output") =>
      !tokens(item[key])
        ? input.t("provider.custom.error.tokens")
        : key !== "context" && item[key].trim() && item.context.trim() && Number(item[key]) > Number(item.context)
          ? input.t("provider.custom.error.context")
          : undefined

    return {
      id: !id
        ? input.t("provider.custom.error.required")
        : duplicate
          ? input.t("provider.custom.error.duplicate")
          : undefined,
      name: !item.name.trim() ? input.t("provider.custom.error.required") : undefined,
      baseURL:
        item.baseURL.trim() && !url(item.baseURL.trim()) && item.baseURL.trim() !== item.source?.settings?.baseURL
          ? input.t("provider.custom.error.baseURL.format")
          : undefined,
      context: limit("context"),
      input: limit("input"),
      output: limit("output"),
    }
  })

  const names = new Set<string>()

  const headers = form.headers.map((item) => {
    const key = item.key.trim()
    const value = item.value.trim()

    if (!key && !value) return {}
    const duplicate = names.has(key.toLowerCase())
    names.add(key.toLowerCase())

    return {
      key: !key
        ? input.t("provider.custom.error.required")
        : duplicate
          ? input.t("provider.custom.error.duplicate")
          : undefined,
      value: !value ? input.t("provider.custom.error.required") : undefined,
    }
  })

  if (
    Object.values(err).some(Boolean) ||
    form.models.length === 0 ||
    models.some((item) => Object.values(item).some(Boolean)) ||
    headers.some((item) => Object.values(item).some(Boolean))
  )
    return { err, models, headers }

  const config: Provider = {
    ...form.source,
    package: form.source && form.wire === wire(form.source.package) ? form.source.package : packages[form.wire],
    name,
    settings: { ...form.source?.settings, baseURL: endpoint },
    headers: Object.fromEntries(
      form.headers.flatMap((item) => (item.key.trim() ? [[item.key.trim(), item.value.trim()]] : [])),
    ),
    models: {
      ...Object.fromEntries(
        Object.entries(form.source?.models ?? {})
          .filter(([id]) => !form.models.some((item) => item.id.trim() === id))
          .map(([id, model]) => [id, { ...model, disabled: true }]),
      ),
      ...Object.fromEntries(
        form.models.map((item) => {
          const settings = { ...item.source?.settings }
          delete settings.baseURL

          if (item.baseURL.trim()) settings.baseURL = item.baseURL.trim().replace(/\/+$/, "")

          return [
            item.id.trim(),
            {
              ...item.source,
              name: item.name.trim(),
              modelID: item.model.trim() || undefined,
              package:
                item.wire === (item.source?.package ? wire(item.source.package) : "")
                  ? item.source?.package
                  : item.wire
                    ? packages[item.wire]
                    : undefined,
              settings,
              limit: {
                context: item.context.trim() ? Number(item.context) : undefined,
                input: item.input.trim() ? Number(item.input) : undefined,
                output: item.output.trim() ? Number(item.output) : undefined,
              },
              variants_mode: "replace",
              variants: [
                ...(item.source?.variants?.filter((variant) => !efforts.some((effort) => effort === variant.id)) ?? []),
                ...item.efforts.map((effort) => {
                  const source = item.source?.variants?.find((variant) => variant.id === effort)

                  if (source && (item.wire || form.wire) === wire(item.source?.package ?? form.source?.package))
                    return source
                  const settings = { ...source?.settings }
                  delete settings.thinking
                  delete settings.effort
                  delete settings.reasoningEffort
                  delete settings.reasoningSummary
                  delete settings.include

                  if ((item.wire || form.wire) === "messages") {
                    settings.thinking = effort === "none" ? { type: "disabled" } : { type: "adaptive" }

                    if (effort !== "none") settings.effort = effort

                    return { ...source, id: effort, settings }
                  }

                  settings.reasoningEffort = effort

                  if ((item.wire || form.wire) === "responses") {
                    settings.reasoningSummary = "auto"
                    settings.include = ["reasoning.encrypted_content"]
                  }

                  return { ...source, id: effort, settings }
                }),
              ],
            },
          ]
        }),
      ),
    },
  }

  return {
    err,
    models,
    headers,
    result: {
      providerID: id,
      name,
      key: secret && !env ? secret : undefined,
      config: env ? { ...config, env: [env] } : config,
    },
  }
}

let row = 0

export const modelRow = (id = "", source?: Model): ModelRow => ({
  row: `row-${row++}`,
  id,
  name: source?.name ?? id,
  model: source?.modelID ?? "",
  wire: source?.package ? wire(source.package) : "",
  baseURL: Option.getOrElse(Schema.decodeUnknownOption(Schema.String)(source?.settings?.baseURL), () => ""),
  context: String(source?.limit?.context ?? 200_000),
  input: source?.limit?.input === undefined ? "" : String(source.limit.input),
  output: String(source?.limit?.output ?? 32_000),
  efforts: source?.variants?.flatMap((variant) => efforts.filter((effort) => effort === variant.id)) ?? [],
  source,
  err: {},
})

export const headerRow = (key = "", value = ""): HeaderRow => ({ row: `row-${row++}`, key, value, err: {} })

export const providerForm = (id = "", source?: Provider): FormState => ({
  providerID: id,
  name: source?.name ?? "",
  baseURL: Option.getOrElse(Schema.decodeUnknownOption(Schema.String)(source?.settings?.baseURL), () => ""),
  wire: wire(source?.package),
  apiKey: "",
  models: source?.models
    ? Object.entries(source.models)
        .filter(([, model]) => !model.disabled)
        .map(([id, model]) => modelRow(id, model))
    : [modelRow()],
  headers:
    source?.headers && Object.keys(source.headers).length
      ? Object.entries(source.headers).map(([key, value]) => headerRow(key, value))
      : [headerRow()],
  source,
  err: {},
})

export function configuredProviders(
  entries: readonly (
    | { type: "directory" }
    | {
        type: "document"
        info: { providers?: Readonly<Record<string, Provider>> }
        source?: { providers?: Readonly<Record<string, Provider>> }
      }
  )[],
) {
  const boundary = entries.findIndex((entry) => entry.type === "directory")
  const documents = (boundary < 0 ? entries : entries.slice(0, boundary)).filter((entry) => entry.type === "document")

  const blocked = new Set(
    documents.flatMap((entry) =>
      entry.source ? Object.keys(entry.info.providers ?? {}).filter((id) => !entry.source?.providers?.[id]) : [],
    ),
  )

  return documents
    .flatMap((entry) => Object.entries((entry.source ?? entry.info).providers ?? {}))
    .filter(([id]) => !blocked.has(id))
    .reduce<Record<string, Provider>>((result, [id, provider]) => {
      const merged: Provider = mergeDeep(result[id] ?? {}, provider)
      result[id] = {
        ...merged,
        headers: headers(result[id]?.headers, provider.headers),
        models: Object.fromEntries(
          Object.entries(merged.models ?? {}).map(([key, model]) => {
            const base = result[id]?.models?.[key]
            const overlay = provider.models?.[key]
            const merged: Model = { ...model, headers: headers(base?.headers, overlay?.headers) }

            if (overlay?.variants && overlay.variants_mode !== "replace") {
              const variants = Object.values(
                [...(base?.variants ?? []), ...overlay.variants].reduce<Record<string, Variant>>((result, variant) => {
                  result[variant.id] = {
                    ...mergeDeep(result[variant.id] ?? {}, variant),
                    headers: headers(result[variant.id]?.headers, variant.headers),
                  }

                  return result
                }, {}),
              )

              return [key, { ...merged, variants }]
            }

            return [key, merged]
          }),
        ),
      }

      return result
    }, {})
}

function headers(base?: Provider["headers"], overlay?: Provider["headers"]) {
  return Object.fromEntries(
    [...Object.entries(base ?? {}), ...Object.entries(overlay ?? {})]
      .reduce((result, entry) => result.set(entry[0].toLowerCase(), entry), new Map<string, [string, string]>())
      .values(),
  )
}
