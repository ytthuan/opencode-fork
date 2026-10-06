import { expect, story } from "../../storybook/playwright/story"

story("shows original welcome artwork at desktop and mobile sizes", async ({ mount, page }) => {
  for (const scenario of [
    { theme: "light", width: 1280, height: 800, motion: "no-preference" },
    { theme: "dark", width: 390, height: 640, motion: "reduce" },
  ] as const) {
    await page.setViewportSize({ width: scenario.width, height: scenario.height })
    await page.emulateMedia({ reducedMotion: scenario.motion })
    const component = await mount("app-new-session-wordmark--reveal", { globals: { theme: scenario.theme } })
    const logo = component.locator('[data-component="new-session-wordmark"]')
    const image = logo.locator(`.welcome-${scenario.theme}`)
    await expect(image).toBeVisible()
    await expect(logo.locator(`.welcome-${scenario.theme === "light" ? "dark" : "light"}`)).toBeHidden()
    await expect
      .poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0))
      .toBe(true)
    expect(
      await image.evaluate((element) => {
        const bounds = element.getBoundingClientRect()

        return bounds.width > 0 && bounds.left >= 0 && bounds.right <= innerWidth
      }),
    ).toBe(true)
    expect(await logo.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0)
  }
})
