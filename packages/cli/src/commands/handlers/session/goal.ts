import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Effect, Option } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerConnection } from "../../../services/server-connection"
import { errorMessage } from "../../../util/error"

const handler = Effect.fn("cli.session.goal")(function* (
  input: Runtime.Input<typeof Commands.commands.session.commands.goal>,
) {
  const server = yield* ServerConnection.resolve({
    server: Option.getOrUndefined(input.server),
    standalone: input.standalone,
  })
  const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
  const objective = Option.getOrUndefined(input.objective)
  const maxRounds = Option.getOrUndefined(input.maxRounds)
  const goal = yield* Effect.tryPromise(async (signal) => {
    if (input.action === "create") {
      if (!objective) throw new Error("--objective is required to create a goal")
      return client.session.createGoal({ sessionID: input.sessionID, objective, maxRounds }, { signal })
    }
    const current = await client.session.goal({ sessionID: input.sessionID }, { signal })
    if (input.action === "get") return current
    if (!current) throw new Error("This session has no goal")
    return client.session.updateGoal(
      {
        sessionID: input.sessionID,
        id: current.id,
        revision: current.revision,
        action: input.action,
        objective,
        maxRounds,
        reason: Option.getOrUndefined(input.reason),
      },
      { signal },
    )
  })
  process.stdout.write(JSON.stringify(goal, null, 2) + EOL)
})

export default Runtime.handler(Commands.commands.session.commands.goal, (input) =>
  handler(input).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        process.stderr.write(errorMessage(error) + EOL)
        process.exitCode = 1
      }),
    ),
  ),
)
