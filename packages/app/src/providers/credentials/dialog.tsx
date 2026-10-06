import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { useMutation } from "@tanstack/solid-query"
import { TextField } from "@opencode/ui/text-field"
import { showToast } from "@/shell/notifications/toast"
import { batch, For } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useData } from "@/runtime/server/current"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import {
  type ModelRow,
  type Provider,
  type Wire,
  efforts,
  headerRow,
  modelRow,
  providerForm,
  validateCustomProvider,
  wires,
} from "./form"
import { CustomManagedProviderIcon } from "@/providers/models/provider-group"
import "./form.css"

export function DialogCustomProvider(props: {
  id: string
  source: Provider
  directory?: string
  onSaved?: () => void
}) {
  const language = useLanguage()

  return (
    <Dialog size="large">
      <DialogHeader>
        <DialogTitle>
          {language.t("provider.custom.edit.title", { provider: props.source.name ?? props.id })}
        </DialogTitle>
      </DialogHeader>
      <CustomProviderForm id={props.id} source={props.source} directory={props.directory} onSaved={props.onSaved} />
    </Dialog>
  )
}

export function CustomProviderForm(
  props: {
    autofocus?: boolean
    id?: string
    source?: Provider
    directory?: string
    onSaved?: (provider: string) => void
  } = {},
) {
  const dialog = useDialog()
  const data = useData()
  const language = useLanguage()
  const server = useServerSDK()
  const [form, setForm] = createStore(providerForm(props.id, props.source))
  const [state, setState] = createStore({ saved: props.id })

  const field = (key: "providerID" | "name" | "baseURL" | "apiKey", value: string) => {
    setForm(key, value)

    if (key !== "apiKey") setForm("err", key, undefined)
  }

  const model = (
    index: number,
    key: "id" | "name" | "model" | "baseURL" | "context" | "input" | "output",
    value: string,
  ) => {
    batch(() => {
      setForm("models", index, key, value)

      if (key !== "model") setForm("models", index, "err", key, undefined)
    })
  }

  const header = (index: number, key: "key" | "value", value: string) => {
    batch(() => {
      setForm("headers", index, key, value)
      setForm("headers", index, "err", key, undefined)
    })
  }

  const validate = () => {
    const output = validateCustomProvider({
      form,
      t: language.t,
      editing: state.saved,
      existingProviderIDs: new Set((data.location.provider.list() ?? []).map((provider) => provider.id)),
    })

    batch(() => {
      setForm("err", output.err)
      output.models.forEach((err, index) => setForm("models", index, "err", err))
      output.headers.forEach((err, index) => setForm("headers", index, "err", err))
    })

    return output.result
  }

  const mutation = useMutation(() => ({
    mutationFn: async (result: NonNullable<ReturnType<typeof validate>>) => {
      await server.api.config.update({ providers: { [result.providerID]: result.config } })
      setState("saved", result.providerID)

      if (result.key) {
        await server.api.credential.create({
          integrationID: result.providerID,
          label: result.name,
          value: { type: "key", key: result.key },
          activate: true,
        })
      }

      const location = props.directory ? { directory: props.directory } : undefined
      data.location.integration.invalidate(location)
      data.location.provider.invalidate(location)
      data.location.model.invalidate(location)
      await Promise.all([
        data.location.integration.sync(location),
        data.location.provider.sync(location),
        data.location.model.sync(location),
      ])

      return result
    },
    onSuccess: (result) => {
      props.onSaved?.(result.providerID)
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: props.id
          ? language.t("provider.custom.saved.title", { provider: result.name })
          : language.t("provider.connect.toast.connected.title", { provider: result.name }),
        description: language.t("provider.custom.saved.description"),
      })
    },
    onError: (err) => {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    },
  }))

  function WireField(props: { id: string; value: Wire | ""; inherit?: boolean; onChange: (wire: Wire | "") => void }) {
    return (
      <div class="custom-provider-field">
        <label for={props.id}>{language.t("provider.custom.api.label")}</label>
        <select
          id={props.id}
          value={props.value}
          onChange={(event) => {
            const value = event.currentTarget.value
            props.onChange(wires.find((wire) => wire === value) ?? "")
          }}
        >
          {props.inherit && <option value="">{language.t("provider.custom.api.inherit")}</option>}
          <For each={wires}>{(wire) => <option value={wire}>{language.t(`provider.custom.api.${wire}`)}</option>}</For>
        </select>
      </div>
    )
  }

  function Limits(props: { item: ModelRow; index: number }) {
    return (
      <div class="custom-provider-limits">
        <For each={["context", "input", "output"] as const}>
          {(key) => (
            <TextField
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              label={language.t(`provider.custom.models.${key}.label`)}
              placeholder={language.t("provider.custom.models.limit.inherit")}
              value={props.item[key]}
              onChange={(value) => model(props.index, key, value)}
              validationState={props.item.err[key] ? "invalid" : undefined}
              error={props.item.err[key]}
            />
          )}
        </For>
      </div>
    )
  }

  return (
    <form
      class="custom-provider-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()

        if (mutation.isPending) return
        const result = validate()

        if (result) mutation.mutate(result)
      }}
    >
      <div class="custom-provider-content">
        <div class="custom-provider-intro">
          <CustomManagedProviderIcon class="size-5 shrink-0" />
          <p>{language.t("provider.custom.api.description")}</p>
        </div>
        <div class="custom-provider-grid">
          <TextField
            autofocus={props.autofocus ?? true}
            label={language.t("provider.custom.field.providerID.label")}
            placeholder={language.t("provider.custom.field.providerID.placeholder")}
            description={language.t("provider.custom.field.providerID.description")}
            value={form.providerID}
            readOnly={!!props.id}
            onChange={(value) => field("providerID", value)}
            validationState={form.err.providerID ? "invalid" : undefined}
            error={form.err.providerID}
          />
          <TextField
            label={language.t("provider.custom.field.name.label")}
            placeholder={language.t("provider.custom.field.name.placeholder")}
            value={form.name}
            onChange={(value) => field("name", value)}
            validationState={form.err.name ? "invalid" : undefined}
            error={form.err.name}
          />
        </div>
        <TextField
          label={language.t("provider.custom.field.baseURL.label")}
          placeholder={language.t("provider.custom.field.baseURL.placeholder")}
          value={form.baseURL}
          onChange={(value) => field("baseURL", value)}
          validationState={form.err.baseURL ? "invalid" : undefined}
          error={form.err.baseURL}
        />
        <WireField id="custom-provider-api" value={form.wire} onChange={(wire) => wire && setForm("wire", wire)} />
        <TextField
          type="password"
          autocomplete="new-password"
          label={language.t("provider.custom.field.apiKey.label")}
          placeholder={language.t("provider.custom.field.apiKey.placeholder")}
          description={language.t(
            props.id ? "provider.custom.field.apiKey.keep" : "provider.custom.field.apiKey.description",
          )}
          value={form.apiKey}
          onChange={(value) => field("apiKey", value)}
        />
        <section class="custom-provider-models">
          <div class="custom-provider-section">
            <h3>{language.t("provider.custom.models.label")}</h3>
            <Button
              type="button"
              size="small"
              variant="ghost"
              icon="plus-small"
              onClick={() => setForm("models", (rows) => [...rows, modelRow()])}
            >
              {language.t("provider.custom.models.add")}
            </Button>
          </div>
          <For each={form.models}>
            {(item, index) => (
              <fieldset class="custom-provider-model">
                <legend>{item.name || language.t("provider.custom.models.row", { index: index() + 1 })}</legend>
                <div class="custom-provider-grid">
                  <TextField
                    label={language.t("provider.custom.models.id.label")}
                    placeholder={language.t("provider.custom.models.id.placeholder")}
                    value={item.id}
                    onChange={(value) => model(index(), "id", value)}
                    validationState={item.err.id ? "invalid" : undefined}
                    error={item.err.id}
                  />
                  <TextField
                    label={language.t("provider.custom.models.name.label")}
                    placeholder={language.t("provider.custom.models.name.placeholder")}
                    value={item.name}
                    onChange={(value) => model(index(), "name", value)}
                    validationState={item.err.name ? "invalid" : undefined}
                    error={item.err.name}
                  />
                </div>
                <TextField
                  label={language.t("provider.custom.models.model.label")}
                  description={language.t("provider.custom.models.model.description")}
                  placeholder={item.id || language.t("provider.custom.models.id.placeholder")}
                  value={item.model}
                  onChange={(value) => model(index(), "model", value)}
                />
                <div class="custom-provider-grid">
                  <WireField
                    id={`${item.row}-api`}
                    value={item.wire}
                    inherit
                    onChange={(wire) => setForm("models", index(), "wire", wire)}
                  />
                  <TextField
                    label={language.t("provider.custom.models.baseURL.label")}
                    placeholder={language.t("provider.custom.api.inherit")}
                    value={item.baseURL}
                    onChange={(value) => model(index(), "baseURL", value)}
                    validationState={item.err.baseURL ? "invalid" : undefined}
                    error={item.err.baseURL}
                  />
                </div>
                <Limits item={item} index={index()} />
                <fieldset class="custom-provider-reasoning">
                  <legend>{language.t("provider.custom.models.efforts.label")}</legend>
                  <p>{language.t("provider.custom.models.efforts.description")}</p>
                  <div class="custom-provider-efforts">
                    <For each={efforts}>
                      {(effort) => (
                        <label class="custom-provider-effort">
                          <input
                            type="checkbox"
                            checked={item.efforts.includes(effort)}
                            onChange={(event) =>
                              setForm(
                                "models",
                                index(),
                                "efforts",
                                event.currentTarget.checked
                                  ? [...item.efforts, effort]
                                  : item.efforts.filter((value) => value !== effort),
                              )
                            }
                          />
                          <span>{language.t(`provider.custom.effort.${effort}`)}</span>
                        </label>
                      )}
                    </For>
                  </div>
                </fieldset>
                <Button
                  type="button"
                  size="small"
                  variant="ghost"
                  icon="trash"
                  class="self-start"
                  disabled={form.models.length <= 1}
                  onClick={() => setForm("models", (rows) => rows.filter((_, current) => current !== index()))}
                >
                  {language.t("provider.custom.models.remove")}
                </Button>
              </fieldset>
            )}
          </For>
        </section>
        <section class="custom-provider-headers">
          <div class="custom-provider-section">
            <h3>{language.t("provider.custom.headers.label")}</h3>
            <Button
              type="button"
              size="small"
              variant="ghost"
              icon="plus-small"
              onClick={() => setForm("headers", (rows) => [...rows, headerRow()])}
            >
              {language.t("provider.custom.headers.add")}
            </Button>
          </div>
          <For each={form.headers}>
            {(item, index) => (
              <div class="custom-provider-header">
                <TextField
                  label={language.t("provider.custom.headers.key.label")}
                  placeholder={language.t("provider.custom.headers.key.placeholder")}
                  value={item.key}
                  onChange={(value) => header(index(), "key", value)}
                  validationState={item.err.key ? "invalid" : undefined}
                  error={item.err.key}
                />
                <TextField
                  label={language.t("provider.custom.headers.value.label")}
                  placeholder={language.t("provider.custom.headers.value.placeholder")}
                  value={item.value}
                  onChange={(value) => header(index(), "value", value)}
                  validationState={item.err.value ? "invalid" : undefined}
                  error={item.err.value}
                />
                <IconButton
                  type="button"
                  icon={<Icon name="trash" />}
                  variant="ghost"
                  class="self-end mb-1"
                  disabled={form.headers.length <= 1}
                  onClick={() =>
                    setForm(
                      "headers",
                      produce((rows) => rows.splice(index(), 1)),
                    )
                  }
                  aria-label={language.t("provider.custom.headers.remove")}
                />
              </div>
            )}
          </For>
        </section>
      </div>
      <div class="custom-provider-footer">
        <Button type="button" variant="ghost" onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </Button>
        <Button type="submit" variant="contrast" disabled={mutation.isPending}>
          {language.t(mutation.isPending ? "common.saving" : props.id ? "common.save" : "common.submit")}
        </Button>
      </div>
    </form>
  )
}
