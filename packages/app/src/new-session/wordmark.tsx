import light from "../../../ui/src/assets/identity/welcome-light.webp"
import dark from "../../../ui/src/assets/identity/welcome-dark.webp"
import "./wordmark.css"

export function NewSessionWordmark() {
  return (
    <div
      data-component="new-session-wordmark"
      aria-hidden="true"
      class="pointer-events-none mx-auto w-full max-w-[720px]"
    >
      <div data-slot="wordmark-reveal">
        <img class="welcome-light" src={light} width="768" height="512" alt="" decoding="async" />
        <img class="welcome-dark" src={dark} width="768" height="512" alt="" decoding="async" />
      </div>
    </div>
  )
}
