import { expect, type Page } from "@playwright/test";

export async function dismissOnboarding(page: Page): Promise<void> {
  const guide = page.getByRole("dialog", { name: "新手引导" });
  await expect(guide).toBeVisible();
  await guide.getByRole("button", { name: "跳过", exact: true }).click();
  await expect(guide).not.toBeVisible();
}

export async function enterApp(page: Page, options: { skipOnboarding?: boolean } = {}): Promise<void> {
  await page.goto("/");
  await page.getByLabel("访问码").fill("yachiyo-local-access");
  await page.getByRole("button", { name: "进入" }).click();
  await expect(page.getByPlaceholder("什么都可以告诉我")).toBeVisible();
  if (options.skipOnboarding !== false) {
    await dismissOnboarding(page);
  }
}
