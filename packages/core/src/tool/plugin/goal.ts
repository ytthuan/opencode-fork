export * as GoalTools from "./goal.js"

import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import { SessionGoal } from "@opencode/schema/session-goal"
import { Form } from "../../form.js"
import { Permission } from "../../permission.js"
import { Effect, Schema } from "effect"

export const Input = Schema.Struct({
  id: SessionGoal.Update.fields.id,
  revision: SessionGoal.Update.fields.revision,
  action: Schema.Literals(["update", "pause", "complete", "block"]),
  objective: SessionGoal.Update.fields.objective,
  reason: SessionGoal.Update.fields.reason,
})

export const Plugin = {
  id: "opencode.tools.goal",
  effect: Effect.fn("GoalTools.Plugin")(function* (ctx: Context) {
    const permission = yield* Permission.Service
    const forms = yield* Form.Service
    yield* ctx.tool
      .transform((editor) => {
        editor.add({
          name: "goal_get",
          description: "Read this session's explicitly created persistent goal. Ordinary work does not create goals.",
          input: Schema.Struct({}),
          output: Schema.NullOr(SessionGoal.Info),
          options: { namespace: "opencode", codemode: true },
          execute: (_, context) =>
            ctx.session.goal({ sessionID: context.sessionID }).pipe(
              Effect.map((goal) => ({ output: goal, content: JSON.stringify(goal) })),
              Effect.mapError((error) => new ToolFailure({ message: "Unable to read goal", error })),
            ),
        })
        editor.add({
          name: "goal_update",
          description:
            "Update an existing goal, mark it complete only when achieved, or block it with a reason. Pause only when the user explicitly requested it; obtain permission for pause. This tool cannot create, clear, or resume goals. Use the latest revision from goal_get.",
          input: Input,
          output: Schema.NullOr(SessionGoal.Info),
          options: { namespace: "opencode", codemode: true },
          execute: (input, context) =>
            Effect.gen(function* () {
              if (input.action === "pause") {
                yield* permission.assert({
                  action: "goal.pause",
                  resources: [context.sessionID],
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source: { type: "tool", messageID: context.messageID, id: context.id },
                })
                const answer = yield* forms.ask({
                  sessionID: context.sessionID,
                  title: "Pause persistent goal",
                  fields: [
                    {
                      key: "pause",
                      type: "boolean",
                      title: "Pause the goal?",
                      description: "Stop automatic goal continuation until you explicitly resume.",
                      required: true,
                    },
                  ],
                  metadata: { kind: "question", tool: { messageID: context.messageID, id: context.id } },
                })
                if (answer.status !== "answered" || answer.answer.pause !== true)
                  return yield* new ToolFailure({ message: "Goal pause was not approved by the user." })
              }
              return yield* ctx.session
                .updateGoal({ ...input, sessionID: context.sessionID })
                .pipe(Effect.map((goal) => ({ output: goal, content: JSON.stringify(goal) })))
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: "Unable to update goal", error }))),
        })
      })
      .pipe(Effect.orDie)
  }),
}
