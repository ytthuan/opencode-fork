export * as ConfigWriter from "./writer.js"

import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer, Scope, Semaphore } from "effect"

export interface Interface {
  readonly lock: Semaphore.Semaphore
  readonly revision: (directory: string) => number
  readonly register: (
    directory: string,
    revision: number,
    reload: Effect.Effect<void>,
  ) => Effect.Effect<boolean, never, Scope.Scope>
  readonly refresh: (directory: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ConfigWriter") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const revisions = new Map<string, number>()
    const listeners = new Set<{ readonly directory: string; readonly reload: Effect.Effect<void> }>()
    return Service.of({
      lock: yield* Semaphore.make(1),
      revision: (directory) => revisions.get(directory) ?? 0,
      register: (directory, revision, reload) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            const listener = { directory, reload }
            listeners.add(listener)
            return listener
          }),
          (listener) => Effect.sync(() => listeners.delete(listener)),
        ).pipe(Effect.map(() => (revisions.get(directory) ?? 0) !== revision)),
      refresh: (directory) =>
        Effect.suspend(() => {
          revisions.set(directory, (revisions.get(directory) ?? 0) + 1)
          return Effect.forEach(
            [...listeners].filter((listener) => listener.directory === directory),
            (listener) => listener.reload,
            { concurrency: "unbounded", discard: true },
          )
        }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
