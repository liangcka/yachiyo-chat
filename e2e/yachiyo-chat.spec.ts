import { expect, test, type Locator, type Page } from "@playwright/test";

async function enterApp(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("访问码").fill("yachiyo-local-access");
  await page.getByRole("button", { name: "进入" }).click();
  await expect(page.getByPlaceholder("什么都可以告诉我")).toBeVisible();
}

async function waitForFiniteAnimations(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const finiteAnimations = document
      .getAnimations()
      .filter((animation) => animation.effect?.getTiming().iterations !== Infinity);
    await Promise.all(
      finiteAnimations.map((animation) => animation.finished.catch(() => undefined)),
    );
  });
}

async function verticalGap(upper: Locator, lower: Locator): Promise<number> {
  const [upperBottom, lowerTop] = await Promise.all([
    upper.evaluate((element) => element.getBoundingClientRect().bottom),
    lower.evaluate((element) => element.getBoundingClientRect().top),
  ]);
  return lowerTop - upperBottom;
}

test("renders a clean two-bar menu button", async ({ page }) => {
  await enterApp(page);

  const menuButton = page.getByRole("button", { name: "菜单" });
  await expect(menuButton.locator("svg path, svg line")).toHaveCount(2);
  await expect(menuButton).toHaveCSS("box-shadow", "none");
});

test.describe("base chat layout", () => {
  test.use({ serviceWorkers: "block" });

  test("keeps the latest assistant reply close to the speaker control", async ({ page }) => {
    await enterApp(page);
    await waitForFiniteAnimations(page);

    const assistantBubble = page.getByRole("article", { name: "八千代的回复" });
    const speakerButton = page.getByRole("button", { name: "扬声器功能即将开放" });
    const gap = await verticalGap(assistantBubble, speakerButton);

    expect(gap).toBeGreaterThanOrEqual(20);
    expect(gap).toBeLessThanOrEqual(36);
  });
});

test("keeps the latest reply clear of a multiline composer", async ({ page }) => {
  await enterApp(page);

  await page.getByPlaceholder("什么都可以告诉我").fill("第一行\n第二行\n第三行\n第四行");
  const gap = await verticalGap(
    page.getByRole("article", { name: "八千代的回复" }),
    page.getByRole("button", { name: "扬声器功能即将开放" }),
  );

  expect(gap).toBeGreaterThanOrEqual(20);
});

test("keeps bottom status banners clear of the latest reply", async ({ context, page }) => {
  await enterApp(page);

  await context.setOffline(true);
  const statusBanner = page.locator(".status-banner");
  await expect(statusBanner).toBeVisible();
  const gap = await verticalGap(
    page.getByRole("article", { name: "八千代的回复" }),
    statusBanner,
  );

  expect(gap).toBeGreaterThanOrEqual(20);
  await context.setOffline(false);
});

test("keeps the PWA prompt clear of the latest reply", async ({ page }) => {
  await enterApp(page);

  const prompt = page.locator(".pwa-prompt");
  await expect(prompt).toBeVisible({ timeout: 10_000 });
  const gap = await verticalGap(
    page.getByRole("article", { name: "八千代的回复" }),
    prompt,
  );

  expect(gap).toBeGreaterThanOrEqual(20);
});

test("streams a mock reply in the reference composition", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await enterApp(page);

  await page.getByPlaceholder("什么都可以告诉我").fill("今天有点累");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByRole("article", { name: "八千代的回复" }).last()).toContainText(
    "笑着递上热乎乎的松饼",
  );
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

  const camera = page.locator('input[type="file"]');
  await expect(camera).toHaveAttribute("accept", "image/*");
  await expect(camera).toHaveAttribute("capture", "environment");
  await expect(camera).toHaveAttribute("aria-hidden", "true");
  await expect(camera).toHaveAttribute("tabindex", "-1");
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
