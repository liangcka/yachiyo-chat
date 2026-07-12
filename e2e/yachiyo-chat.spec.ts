import { expect, test, type Page } from "@playwright/test";

async function enterApp(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("访问码").fill("yachiyo-local-access");
  await page.getByRole("button", { name: "进入" }).click();
  await expect(page.getByPlaceholder("什么都可以告诉我")).toBeVisible();
}

test("streams a mock reply in the reference composition", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await enterApp(page);

  await page.getByPlaceholder("什么都可以告诉我").fill("今天有点累");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText(/彩叶.*辛苦/)).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);

  if (testInfo.project.name === "mobile-390") {
    await page.screenshot({
      animations: "disabled",
      path: testInfo.outputPath("yachiyo-chat-390x844.png"),
    });
  } else {
    const stage = page.locator(".chat-stage");
    await expect(stage).toBeVisible();
    await expect
      .poll(() => stage.evaluate((element) => Math.round(element.getBoundingClientRect().width)))
      .toBeLessThanOrEqual(430);
  }
  expect(consoleErrors).toEqual([]);
});

test("switches language, exposes camera input, and becomes read-only offline", async ({
  context,
  page,
}) => {
  await enterApp(page);

  await page.getByRole("button", { name: "菜单" }).click();
  await page.getByRole("button", { name: "日本語" }).click();
  await expect(page.getByPlaceholder("何でも話してね")).toBeVisible();

  const camera = page.getByLabel("撮影");
  await expect(camera).toHaveAttribute("accept", "image/*");
  await expect(camera).toHaveAttribute("capture", "environment");
  await expect(page.getByRole("button", { name: "マイク機能は近日公開です" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );

  await context.setOffline(true);
  await expect(page.getByText("オフラインです。端末の履歴は閲覧できます")).toBeVisible();
  await expect(page.getByPlaceholder("何でも話してね")).toBeDisabled();
  await context.setOffline(false);
  await expect(page.getByPlaceholder("何でも話してね")).toBeEnabled();
});
