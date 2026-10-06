import { expect, test } from "bun:test"
import { TokenUsage } from "../src/token-usage.js"

test("totals every token category", () => {
  expect(TokenUsage.total({ input: 1, output: 2, reasoning: 4, cache: { read: 8, write: 16 } })).toBe(31)
})

test("supports zero and large usage totals without rounding", () => {
  expect(TokenUsage.total({ input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } })).toBe(0)
  expect(
    TokenUsage.total({
      input: 1_000_000_000,
      output: 2_000_000_000,
      reasoning: 3,
      cache: { read: 4_000_000_000, write: 5 },
    }),
  ).toBe(7_000_000_008)
})

test("cache hits divide cached reads by every input category, excluding output and reasoning", () => {
  const tokens = { input: 60, output: 900, reasoning: 800, cache: { read: 30, write: 10 } }
  expect(TokenUsage.input(tokens)).toBe(100)
  expect(TokenUsage.hit(tokens)).toBe(0.3)
  expect(TokenUsage.hit({ ...tokens, input: 0, cache: { read: 30, write: 0 } })).toBe(1)
  expect(TokenUsage.hit({ ...tokens, cache: { read: 0, write: 10 } })).toBe(0)
  expect(TokenUsage.hit({ ...tokens, input: 0, cache: { read: 0, write: 0 } })).toBeUndefined()
})
