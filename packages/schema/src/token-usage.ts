export * as TokenUsage from "./token-usage.js"

import { Schema } from "effect"

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  input: Schema.Finite,
  output: Schema.Finite,
  reasoning: Schema.Finite,
  cache: Schema.Struct({
    read: Schema.Finite,
    write: Schema.Finite,
  }),
}).annotate({ identifier: "TokenUsage.Info" })

export function total(tokens: Info) {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
}

/** All input tokens, including cache reads and writes. */
export function input(tokens: Info) {
  return tokens.input + tokens.cache.read + tokens.cache.write
}

/** The fraction of all input served from cache; absent before any input is recorded. */
export function hit(tokens: Info) {
  const count = input(tokens)
  return count > 0 ? tokens.cache.read / count : undefined
}
