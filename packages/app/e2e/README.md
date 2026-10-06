# Browser launch preflight

Before local browser verification, run this diagnostic from `packages/app` with the intended Bun runtime:

```sh
bun script/browser-preflight.ts
```

For a runner explicitly configured to use installed Chrome:

```sh
bun script/browser-preflight.ts '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
```

The diagnostic does not launch a browser. It rejects the reported Codex macOS seatbelt context and checks that the selected executable exists. The runner marker is diagnostic evidence, not an OS permission probe; a passing preflight does not guarantee launch permission. It does not configure Playwright's executable.

On October 6, 2026, the provider verification runner launched Chrome PID 74172 from Playwright worker PID 74169 inside the OS sandbox. Chrome aborted during HIServices application registration / `TransformProcessType`, about 115 ms after startup. The host-approved rerun reached UI assertions. This failure happened before page loading; it does not identify an OpenCode application defect.

If preflight reports seatbelt, request `require_escalated` tool execution for both preflight and the intended browser command. Do not unset the marker, use sandbox escape commands, or add Chrome flags to work around OS restrictions. Chrome's `--no-sandbox` flag does not authorize macOS LaunchServices access. If an authorized launch still fails, preserve its launch log and stop before repeating a crash-producing command.

Keep browser selection and optional media settings in the owning verification configuration. The temporary provider runner used installed Chrome and disabled video; this does not change the repository's Chromium defaults. A missing browser or ffmpeg is a separate prerequisite failure.

For an already running app, use `PLAYWRIGHT_BASE_URL` so the app configuration leaves it unmanaged. Check component-runner server behavior separately before running against Storybook. Do not restart existing apps or servers, overwrite active Electron builds, or terminate unrelated browser processes. Use an isolated browser context and close only the browser launched by the verification command.
