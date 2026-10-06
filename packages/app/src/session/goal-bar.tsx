import type { SessionInfo } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useServerSDK } from "@/runtime/server/client"
import { useLanguage } from "@/runtime/i18n/language"
import { errorMessage } from "@/shell/layout/helpers"

export function SessionGoalBar(props: { session?: SessionInfo }) {
  const sdk = useServerSDK()
  const language = useLanguage()
  const [state, setState] = createStore({ editing: false, objective: "", maxRounds: 256, busy: false, error: "" })
  const change = async (action: "create" | "update" | "pause" | "resume" | "complete" | "clear") => {
    const session = props.session
    if (!session || state.busy) return
    setState({ busy: true, error: "" })
    try {
      if (action === "create")
        await sdk.api.session.createGoal({
          sessionID: session.id,
          objective: state.objective,
          maxRounds: state.maxRounds,
        })
      if (session.goal && action !== "create")
        await sdk.api.session.updateGoal({
          sessionID: session.id,
          id: session.goal.id,
          revision: session.goal.revision,
          action,
          ...(action === "update" ? { objective: state.objective, maxRounds: state.maxRounds } : {}),
        })
      setState("editing", false)
    } catch (error) {
      setState("error", errorMessage(error, language.t("session.goal.failed")))
    } finally {
      setState("busy", false)
    }
  }
  const edit = () =>
    setState({
      editing: true,
      objective: props.session?.goal?.objective ?? "",
      maxRounds: props.session?.goal?.maxRounds ?? 256,
      error: "",
    })
  return (
    <Show when={props.session}>
      <section
        class="flex shrink-0 flex-col gap-2 border-b border-v2-border-base px-3 py-2 text-13 leading-[var(--line-height-base)]"
        aria-label={language.t("session.goal.label")}
      >
        <Show
          when={props.session?.goal}
          fallback={
            <Button size="small" variant="ghost" onClick={edit}>
              {language.t("session.goal.create")}
            </Button>
          }
        >
          {(goal) => (
            <>
              <div class="flex flex-wrap items-center gap-2">
                <span class="min-w-0 flex-1 break-words">{goal().objective}</span>
                <span>
                  {language.t(`session.goal.status.${goal().status}`)} · {goal().rounds}/{goal().maxRounds}
                </span>
                <Button size="small" variant="ghost" disabled={state.busy} onClick={edit}>
                  {language.t("session.goal.update")}
                </Button>
                <For
                  each={
                    goal().status === "complete"
                      ? (["clear"] as const)
                      : goal().status === "active"
                        ? (["pause", "resume", "complete", "clear"] as const)
                        : (["resume", "complete", "clear"] as const)
                  }
                >
                  {(action) => (
                    <Button size="small" variant="ghost" disabled={state.busy} onClick={() => void change(action)}>
                      {language.t(`session.goal.${action}`)}
                    </Button>
                  )}
                </For>
              </div>
              <Show when={goal().reason}>
                <p>{goal().reason}</p>
              </Show>
            </>
          )}
        </Show>
        <Show when={state.editing}>
          <form
            class="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void change(props.session?.goal ? "update" : "create")
            }}
          >
            <textarea
              rows={2}
              class="min-w-0 flex-1 rounded border border-v2-border-base bg-transparent px-2 py-1"
              aria-label={language.t("session.goal.objective")}
              placeholder={language.t("session.goal.objective")}
              value={state.objective}
              required
              maxLength={16384}
              onInput={(event) => setState("objective", event.currentTarget.value)}
            />
            <input
              class="w-20 rounded border border-v2-border-base bg-transparent px-2 py-1"
              type="number"
              min="1"
              step="1"
              required
              aria-label={language.t("session.goal.maxRounds")}
              value={state.maxRounds}
              onInput={(event) => setState("maxRounds", event.currentTarget.valueAsNumber)}
            />
            <Button size="small" disabled={state.busy} type="submit">
              {language.t("session.goal.save")}
            </Button>
            <Button size="small" variant="ghost" type="button" onClick={() => setState("editing", false)}>
              {language.t("session.goal.cancel")}
            </Button>
          </form>
        </Show>
        <Show when={state.error}>
          <p role="alert">{state.error}</p>
        </Show>
      </section>
    </Show>
  )
}
