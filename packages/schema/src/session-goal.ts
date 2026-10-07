export * as SessionGoal from "./session-goal.js"

import { Schema } from "effect"
import { optional, PositiveInt } from "./schema.js"

export const Status = Schema.Literals(["active", "paused", "blocked", "complete"]).annotate({
  identifier: "Session.Goal.Status",
})
export const Objective = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(16384)).annotate({
  identifier: "Session.Goal.Objective",
})
export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: Schema.String,
  revision: PositiveInt,
  objective: Objective,
  status: Status,
  rounds: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  maxRounds: PositiveInt,
  reason: Schema.String.pipe(optional),
}).annotate({ identifier: "Session.Goal.Info" })
export const Create = Schema.Struct({
  objective: Objective,
  maxRounds: PositiveInt.pipe(optional),
}).annotate({ identifier: "Session.Goal.Create" })
export const Update = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1)),
  revision: PositiveInt,
  action: Schema.Literals(["update", "pause", "resume", "complete", "block", "clear"]),
  objective: Objective.pipe(optional),
  maxRounds: PositiveInt.pipe(optional),
  reason: Schema.String.pipe(optional),
}).annotate({ identifier: "Session.Goal.Update" })
/** Irreducible goal mutations; revision and round counts are projection-owned. */
export const Change = Schema.Union([
  Schema.Struct({ type: Schema.Literal("created"), id: Schema.String, ...Create.fields }),
  Schema.Struct({
    type: Schema.Literal("edited"),
    objective: Objective.pipe(optional),
    maxRounds: PositiveInt.pipe(optional),
  }),
  Schema.Struct({
    type: Schema.Literal("status"),
    status: Status,
    reason: Schema.String.pipe(optional),
    maxRounds: PositiveInt.pipe(optional),
  }),
  Schema.Struct({ type: Schema.Literal("cleared") }),
  Schema.Struct({ type: Schema.Literal("round-started") }),
]).annotate({ identifier: "Session.Goal.Change" })
export type Change = typeof Change.Type
export type Create = typeof Create.Type
export type Update = typeof Update.Type
