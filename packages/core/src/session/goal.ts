export * as SessionGoal from "./goal.js"

import { eq } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { SessionGoal } from "@opencode/schema/session-goal"
import type { Session } from "@opencode/schema/session"
import type { Database } from "../database/database.js"
import type { Bus } from "../bus.js"
import { SessionTable } from "./sql.js"
import { SessionEvent } from "./event.js"
import { SessionInbox } from "@opencode/schema/session-inbox"
import { list } from "./inbox.js"
import { SessionMessage } from "./message.js"
import { NotFoundError } from "./error.js"

export const Info = SessionGoal.Info
export const Create = SessionGoal.Create
export const Update = SessionGoal.Update
export type Info = SessionGoal.Info
export type Create = SessionGoal.Create
export type Update = SessionGoal.Update

export class Conflict extends Schema.TaggedError<Conflict>()("Session.GoalConflict", { message: Schema.String }) {}
// Continuation authority is deliberately not persisted or inherited by forks/restarts.
const armed = new Map<Session.ID, string>()
export const disarm = (sessionID: Session.ID) => armed.delete(sessionID)
export const isArmed = (sessionID: Session.ID, goal: SessionGoal.Info) => armed.get(sessionID) === goal.id

export const get = Effect.fn("SessionGoal.get")(function* (db: Database.Interface["db"], sessionID: Session.ID) {
  const row = yield* db
    .select({ goal: SessionTable.goal })
    .from(SessionTable)
    .where(eq(SessionTable.id, sessionID))
    .get()
    .pipe(Effect.orDie)
  if (!row) return yield* new NotFoundError({ sessionID })
  return row.goal ?? null
})

export function fold(current: SessionGoal.Info | null, change: SessionGoal.Change): SessionGoal.Info | null {
  if (change.type === "created")
    return SessionGoal.Info.make({
      id: change.id,
      revision: 1,
      objective: change.objective,
      status: "active",
      rounds: 0,
      maxRounds: change.maxRounds ?? 256,
    })
  if (!current) throw new Conflict({ message: "This session has no goal." })
  if (change.type === "cleared") return null
  if (change.type === "round-started") return { ...current, revision: current.revision + 1, rounds: current.rounds + 1 }
  if (change.type === "edited")
    return {
      ...current,
      revision: current.revision + 1,
      ...(change.objective === undefined ? {} : { objective: change.objective }),
      ...(change.maxRounds === undefined ? {} : { maxRounds: change.maxRounds }),
    }
  return {
    ...current,
    revision: current.revision + 1,
    status: change.status,
    reason: change.reason,
    ...(change.maxRounds === undefined ? {} : { maxRounds: change.maxRounds }),
  }
}

export function transition(current: SessionGoal.Info, input: SessionGoal.Update): SessionGoal.Info | null {
  if (current.id !== input.id || current.revision !== input.revision)
    throw new Conflict({ message: "Goal changed; refresh before updating." })
  if (input.objective !== undefined && input.action !== "update")
    throw new Conflict({ message: "Use update to edit the objective." })
  if (input.maxRounds !== undefined && input.action !== "update" && input.action !== "resume")
    throw new Conflict({ message: "Use update or resume to edit the round limit." })
  if (input.action === "update" && input.objective === undefined && input.maxRounds === undefined)
    throw new Conflict({ message: "Specify an objective or round limit to update." })
  if (input.action === "clear") return null
  if (input.action !== "update" && current.status === "complete")
    throw new Conflict({ message: "Completed goals cannot be resumed. Create a new goal." })
  const objective = input.objective?.trim() ?? current.objective
  if (!objective) throw new Conflict({ message: "Goal objective must not be blank." })
  const maxRounds = input.maxRounds ?? current.maxRounds
  if (input.action === "resume" && current.rounds >= maxRounds)
    throw new Conflict({ message: "Increase the round limit before resuming." })
  const status =
    input.action === "update"
      ? current.status
      : input.action === "resume"
        ? "active"
        : input.action === "block"
          ? "blocked"
          : input.action === "pause"
            ? "paused"
            : "complete"
  const reason = status === "blocked" ? (input.reason?.trim() ?? current.reason) : undefined
  if (status === "blocked" && !reason) throw new Conflict({ message: "A blocked goal requires a reason." })
  return {
    ...current,
    revision: current.revision + 1,
    objective,
    maxRounds,
    status,
    ...(reason ? { reason } : { reason: undefined }),
  }
}

export const create = Effect.fn("SessionGoal.create")(function* (
  db: Database.Interface["db"],
  bus: Bus.Interface,
  sessionID: Session.ID,
  input: SessionGoal.Create,
) {
  const objective = input.objective.trim()
  if (!objective) return yield* new Conflict({ message: "Goal objective must not be blank." })
  const current = yield* get(db, sessionID)
  if (current && current.status !== "complete")
    return yield* new Conflict({ message: "An unfinished goal already exists. Update or clear it first." })
  const goal = SessionGoal.Info.make({
    id: crypto.randomUUID(),
    revision: 1,
    objective,
    status: "active",
    rounds: 0,
    maxRounds: input.maxRounds ?? 256,
  })
  yield* bus
    .publishAll([
      [
        SessionEvent.GoalChanged,
        {
          sessionID,
          previousID: current?.id ?? null,
          previousRevision: current?.revision ?? 0,
          change: { type: "created", id: goal.id, objective, maxRounds: goal.maxRounds },
        },
      ],
      [
        SessionEvent.InboxEnqueued,
        {
          sessionID,
          inboxID: SessionMessage.ID.create(),
          item: {
            type: "synthetic",
            delivery: "steer",
            payload: SessionInbox.SyntheticPayload.make({
              text: `Work toward the persistent goal: ${goal.objective}`,
              metadata: { source: "goal", goalID: goal.id },
            }),
          },
        },
      ],
    ])
    .pipe(Effect.catchDefect((error) => (error instanceof Conflict ? Effect.fail(error) : Effect.die(error))))
  armed.set(sessionID, goal.id)
  return goal
})

export const update = Effect.fn("SessionGoal.update")(function* (
  db: Database.Interface["db"],
  bus: Bus.Interface,
  sessionID: Session.ID,
  input: SessionGoal.Update,
) {
  const current = yield* get(db, sessionID)
  if (!current) return yield* new Conflict({ message: "This session has no goal." })
  const goal = yield* Effect.try({
    try: () => transition(current, input),
    catch: (error) => (error instanceof Conflict ? error : new Conflict({ message: String(error) })),
  })
  // Revision validation and prompt admission share the Bus transaction.
  const change: SessionGoal.Change = !goal
    ? { type: "cleared" }
    : input.action === "update"
      ? {
          type: "edited",
          ...(input.objective === undefined ? {} : { objective: goal.objective }),
          ...(input.maxRounds === undefined ? {} : { maxRounds: goal.maxRounds }),
        }
      : {
          type: "status",
          status: goal.status,
          ...(input.maxRounds === undefined ? {} : { maxRounds: goal.maxRounds }),
          ...(goal.reason === undefined ? {} : { reason: goal.reason }),
        }
  const changed = [
    SessionEvent.GoalChanged,
    { sessionID, change, previousID: current.id, previousRevision: current.revision },
  ] as const
  const pending = yield* list(db, sessionID)
  const cancelled =
    goal?.status === "active"
      ? []
      : pending.filter((item) => item.type === "synthetic" && item.payload.metadata?.source === "goal")
  const publication =
    goal && input.action === "resume"
      ? bus
          .publishAll([
            changed,
            [
              SessionEvent.InboxEnqueued,
              {
                sessionID,
                inboxID: SessionMessage.ID.create(),
                item: {
                  type: "synthetic",
                  delivery: "steer",
                  payload: SessionInbox.SyntheticPayload.make({
                    text: `Resume the persistent goal: ${goal.objective}`,
                    metadata: { source: "goal", goalID: goal.id },
                  }),
                },
              },
            ],
          ])
          .pipe(Effect.asVoid)
      : bus
          .publishAll([
            changed,
            ...cancelled.map((item) => [SessionEvent.InboxCancelled, { sessionID, inboxID: item.id }] as const),
          ])
          .pipe(Effect.asVoid)
  yield* publication.pipe(
    Effect.catchDefect((error) => (error instanceof Conflict ? Effect.fail(error) : Effect.die(error))),
  )
  if (!goal || goal.status !== "active") disarm(sessionID)
  if (goal && input.action === "resume") armed.set(sessionID, goal.id)
  return goal
})

export const nextRound = Effect.fn("SessionGoal.nextRound")(function* (
  db: Database.Interface["db"],
  bus: Bus.Interface,
  sessionID: Session.ID,
) {
  const goal = yield* get(db, sessionID).pipe(Effect.orDie)
  if (!goal || goal.status !== "active" || !isArmed(sessionID, goal)) return false
  if (goal.rounds >= goal.maxRounds) {
    yield* update(db, bus, sessionID, {
      id: goal.id,
      revision: goal.revision,
      action: "block",
      reason: "Goal round limit reached. Increase the limit and explicitly resume.",
    }).pipe(
      Effect.catchTag("Session.GoalConflict", () => Effect.void),
      Effect.orDie,
    )
    return false
  }
  const admitted = yield* bus
    .publishAll([
      [
        SessionEvent.GoalChanged,
        { sessionID, previousID: goal.id, previousRevision: goal.revision, change: { type: "round-started" } },
      ],
      [
        SessionEvent.Synthetic,
        {
          sessionID,
          text: `Continue the persistent goal: ${goal.objective}\nReview progress, complete it only when achieved, or block it with a concrete reason.`,
          metadata: { source: "goal", goalID: goal.id },
        },
      ],
    ])
    .pipe(
      Effect.as(true),
      Effect.catchDefect((error) => (error instanceof Conflict ? Effect.succeed(false) : Effect.die(error))),
    )
  return admitted
})
