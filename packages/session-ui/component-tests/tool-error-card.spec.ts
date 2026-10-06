import { expect, story } from "../../storybook/playwright/story"

story("expands and copies a plain interruption error without a colon", async ({ mount, page }) => {
  const root = await mount("components-tool-error-card--all")
  const card = root.locator('[data-kind="tool-error-card"]').filter({ hasText: "Tool execution interrupted" }).first()
  const trigger = card.getByRole("button", { name: /Tool execution interrupted/ })
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await trigger.focus()
  await page.keyboard.press("Enter")
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await expect(card.locator('[data-slot="card-description"]')).toHaveText("Tool execution interrupted")
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
  await card.getByRole("button", { name: "Copy error", exact: true }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("Tool execution interrupted")
})
