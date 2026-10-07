import type { SessionInfo } from "@opencode/client"
import { createMemo, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { TextAttributes } from "@opentui/core"
import { useClient } from "../context/client"
import { useData } from "../context/data"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogSelect, type DialogSelectRef } from "../ui/dialog-select"
import { errorMessage } from "../util/error"

export function DialogSessionGoal(props: { sessionID: string }) {
  const client = useClient()
  const data = useData()
  const dialog = useDialog()
  const theme = useTheme().surface("dialog")
  const goal = createMemo(() => data.session.get(props.sessionID)?.goal)
  let select: DialogSelectRef<string> | undefined
  const [state, setState] = createStore({
    busy: false,
    error: "",
    edit: undefined as "objective" | "limit" | "block" | undefined,
  })

  async function change(
    action: "create" | "update" | "pause" | "resume" | "complete" | "block" | "clear",
    value?: string,
  ) {
    if (state.busy) return
    const current = goal()
    const maxRounds = state.edit === "limit" ? Number(value) : undefined
    if (maxRounds !== undefined && (!Number.isSafeInteger(maxRounds) || maxRounds < 1)) {
      setState("error", "Enter a positive whole number of automatic rounds.")
      return
    }
    if (value !== undefined && !value.trim()) {
      setState("error", "Enter a goal objective or blocking reason.")
      return
    }
    setState({ busy: true, error: "" })
    try {
      if (action === "create")
        await client.api.session.createGoal({ sessionID: props.sessionID, objective: value?.trim() ?? "" })
      if (current && action !== "create")
        await client.api.session.updateGoal({
          sessionID: props.sessionID,
          id: current.id,
          revision: current.revision,
          action,
          ...(state.edit === "objective" ? { objective: value?.trim() } : {}),
          ...(maxRounds === undefined ? {} : { maxRounds }),
          ...(state.edit === "block" ? { reason: value?.trim() } : {}),
        })
      data.session.invalidate(props.sessionID)
      await data.session.sync(props.sessionID)
      setState("edit", undefined)
    } catch (error) {
      setState("error", errorMessage(error))
      data.session.invalidate(props.sessionID)
      await data.session.sync(props.sessionID).catch(() => {})
    } finally {
      setState("busy", false)
      if (!state.edit) select?.setFilter("")
    }
  }

  const edit = (field: "objective" | "limit" | "block") => setState({ edit: field, error: "" })
  return (
    <box>
      <Show
        when={state.edit}
        fallback={
          <DialogSelect
            title="Persistent goal"
            ref={(value) => (select = value)}
            locked={state.busy}
            titleView={
              <box gap={1}>
                <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
                  Persistent goal
                </text>
                <Show
                  when={goal()}
                  fallback={<text fg={theme.text.muted}>Only an explicit goal starts automatic work.</text>}
                >
                  {(current) => (
                    <>
                      <text fg={theme.text.base}>{current().objective}</text>
                      <text fg={theme.text.muted}>
                        {current().status} · {current().rounds}/{current().maxRounds} automatic rounds
                      </text>
                      <Show when={current().reason}>
                        {(reason) => <text fg={theme.text.feedback.warning.base}>{reason()}</text>}
                      </Show>
                    </>
                  )}
                </Show>
              </box>
            }
            options={
              goal()
                ? [
                    { title: "Edit objective", value: "objective" },
                    { title: "Change automatic round limit", value: "limit" },
                    ...(goal()?.status === "complete"
                      ? []
                      : [
                          ...(goal()?.status === "active" ? [{ title: "Pause goal", value: "pause" }] : []),
                          {
                            title: "Resume goal",
                            value: "resume",
                            description: "Explicitly start or rearm automatic work.",
                          },
                          { title: "Complete goal", value: "complete" },
                          { title: "Block goal", value: "block" },
                        ]),
                    { title: "Clear goal", value: "clear" },
                  ]
                : [{ title: "Set goal", value: "objective" }]
            }
            footer={
              <box paddingLeft={4} paddingRight={4} paddingBottom={1}>
                <text fg={state.error ? theme.text.feedback.error.base : theme.text.muted}>
                  {state.error || "Pause takes effect at a safe boundary. Use Stop to interrupt immediately."}
                </text>
              </box>
            }
            onSelect={(option) => {
              if (option.value === "objective" || option.value === "limit" || option.value === "block")
                return edit(option.value)
              if (
                option.value === "pause" ||
                option.value === "resume" ||
                option.value === "complete" ||
                option.value === "clear"
              )
                void change(option.value)
            }}
            onCancel={() => dialog.clear()}
          />
        }
      >
        {(field) => (
          <DialogPrompt
            title={
              field() === "limit"
                ? "Automatic round limit"
                : field() === "block"
                  ? "Blocking reason"
                  : goal()
                    ? "Edit goal"
                    : "Set goal"
            }
            value={
              field() === "limit" ? String(goal()?.maxRounds ?? 256) : field() === "objective" ? goal()?.objective : ""
            }
            placeholder={
              field() === "limit"
                ? "Positive whole number"
                : field() === "block"
                  ? "What prevents progress?"
                  : "What should this session achieve?"
            }
            busy={state.busy}
            description={() => (
              <Show when={state.error}>{(error) => <text fg={theme.text.feedback.error.base}>{error()}</text>}</Show>
            )}
            onConfirm={(value) => void change(field() === "block" ? "block" : goal() ? "update" : "create", value)}
            onCancel={() => setState({ edit: undefined, error: "" })}
          />
        )}
      </Show>
    </box>
  )
}

export function SessionGoalStatus(props: { session: SessionInfo; onOpen: () => void }) {
  const theme = useTheme()
  return (
    <Show when={props.session.goal}>
      {(goal) => (
        <box flexDirection="row" gap={1} flexShrink={0} paddingTop={1} onMouseUp={props.onOpen}>
          <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
            Goal
          </text>
          <text fg={theme.text.muted} wrapMode="none" truncate flexShrink={1}>
            {goal().status} · {goal().rounds}/{goal().maxRounds} · {goal().objective}
          </text>
          <text fg={theme.text.action.secondary.base}>/goal</text>
        </box>
      )}
    </Show>
  )
}
