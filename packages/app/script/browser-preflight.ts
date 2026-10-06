import { chromium } from "@playwright/test"

// This diagnoses the runner; it does not change or escape the OS sandbox.
if (process.platform === "darwin" && process.env.CODEX_SANDBOX === "seatbelt") {
  console.error(
    "Browser preflight blocked: Codex reports a macOS seatbelt sandbox. Request authorized host execution for this preflight and the browser command before launching Chrome. Do not unset CODEX_SANDBOX or add browser flags to bypass this check.",
  )
  process.exit(1)
}

const file = process.argv[2] ?? chromium.executablePath()

if (!(await Bun.file(file).exists())) {
  console.error(
    `Browser executable missing: ${file}. Install the Playwright browser or supply an installed executable.`,
  )
  process.exit(1)
}

console.log(`Browser preflight passed: ${file}`)

console.log("No browser was launched. Executable presence and the runner marker do not prove OS launch permission.")
