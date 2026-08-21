import { expect, test, type Locator, type Page } from "@playwright/test";

async function enterApp(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator(".access-gate")).toBeVisible();
  await page.locator(".access-gate input").fill("yachiyo-local-access");
  await page.locator('.access-gate button[type="submit"]').click();
  await expect(page.locator(".composer textarea")).toBeVisible();
}

/** 新会话没有初始问候气泡，断言前先发一条消息等 mock 回复让消息列表出现 */
async function sendMockMessage(page: Page): Promise<void> {
  await page.locator(".composer textarea").fill("今天有点累");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.locator(".message-list__item").last()).toContainText(
    "笑着递上热乎乎的松饼",
  );
}

type MotionStyle = {
  animationDelay: string;
  animationDuration: string;
  animationIterationCount: string;
  animationName: string;
  transitionDelay: string;
  transitionDuration: string;
};

async function motionStyle(
  locator: Locator,
  pseudo?: "::before" | "::after",
): Promise<MotionStyle> {
  return locator.evaluate((element, targetPseudo) => {
    const style = getComputedStyle(element, targetPseudo);
    return {
      animationDelay: style.animationDelay,
      animationDuration: style.animationDuration,
      animationIterationCount: style.animationIterationCount,
      animationName: style.animationName,
      transitionDelay: style.transitionDelay,
      transitionDuration: style.transitionDuration,
    };
  }, pseudo);
}

function maximumCssTimeInMilliseconds(value: string): number {
  return Math.max(
    ...value.split(",").map((part) => {
      const time = Number.parseFloat(part);
      return part.trim().endsWith("ms") ? time : time * 1_000;
    }),
  );
}

async function expectEffectiveAnimation(
  locator: Locator,
  pseudo?: "::before" | "::after",
): Promise<void> {
  const motion = await motionStyle(locator, pseudo);
  expect(motion.animationName).not.toBe("none");
  expect(maximumCssTimeInMilliseconds(motion.animationDuration)).toBeGreaterThan(0);
}

function expectCollapsedMotion(motion: MotionStyle): void {
  for (const value of [
    motion.animationDuration,
    motion.animationDelay,
    motion.transitionDuration,
    motion.transitionDelay,
  ]) {
    expect(maximumCssTimeInMilliseconds(value)).toBeLessThanOrEqual(0.01);
  }

  expect(
    motion.animationIterationCount
      .split(",")
      .every((iteration) => Number.parseFloat(iteration) <= 1),
  ).toBe(true);
}

async function transformScale(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return Math.hypot(matrix.a, matrix.b);
  });
}

async function transformTranslateY(locator: Locator): Promise<number> {
  return locator.evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).f);
}

test.describe("motion system", () => {
  test.use({ serviceWorkers: "block" });

  test("animates the ambient, entrance, message, and panel layers", async ({ page }) => {
    await page.goto("/");

    const accessGate = page.locator(".access-gate");
    await expect(accessGate).toBeVisible();
    await expectEffectiveAnimation(accessGate);
    await expectEffectiveAnimation(page.locator(".chat-stage"), "::before");

    await page.locator(".access-gate input").fill("yachiyo-local-access");
    await page.locator('.access-gate button[type="submit"]').click();
    await expect(page.locator(".composer textarea")).toBeVisible();

    await sendMockMessage(page);

    for (const selector of [
      ".top-controls",
      ".message-list__item",
      ".control-dock",
      ".composer",
    ]) {
      await expectEffectiveAnimation(page.locator(selector).first());
    }

    const menuMotion = await page.locator(".top-controls__menu").evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        duration: style.transitionDuration,
        property: style.transitionProperty,
      };
    });
    expect(maximumCssTimeInMilliseconds(menuMotion.duration)).toBeGreaterThan(0);
    expect(menuMotion.property).toContain("transform");

    await page.locator(".top-controls__menu").click();
    const overlay = page.locator(".overlay");
    await expect(overlay).toBeVisible();
    await expectEffectiveAnimation(overlay);
    await expectEffectiveAnimation(page.locator(".drawer"));
  });

  test("collapses decorative motion when reduced motion is requested", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await enterApp(page);
    await sendMockMessage(page);
    await page.locator(".top-controls__menu").click();
    await expect(page.locator(".drawer")).toBeVisible();

    for (const selector of [
      ".chat-stage",
      ".top-controls",
      ".message-list__item",
      ".control-dock",
      ".composer",
      ".overlay",
      ".drawer",
    ]) {
      expectCollapsedMotion(await motionStyle(page.locator(selector).first()));
    }

    expectCollapsedMotion(await motionStyle(page.locator(".chat-stage"), "::before"));
    expectCollapsedMotion(await motionStyle(page.locator(".starfield")));
  });

  test("animates transient feedback and nested panel content", async ({ context, page }) => {
    await enterApp(page);

    await context.setOffline(true);
    const statusBanner = page.locator(".status-banner");
    await expect(statusBanner).toBeVisible();
    await expectEffectiveAnimation(statusBanner);

    await context.setOffline(false);
    await expect(page.locator(".composer textarea")).toBeEnabled();
    await page.locator(".control-dock__button--reserved").first().click({ force: true });
    const toast = page.locator(".toast");
    await expect(toast).toBeVisible();
    await expectEffectiveAnimation(toast);

    await page.locator(".top-controls__menu").click();
    await page.locator(".drawer__actions button").nth(1).click();
    const firstHistoryItem = page.locator(".history-panel > ol > li").first();
    await expect(firstHistoryItem).toBeVisible();
    await expectEffectiveAnimation(firstHistoryItem);
  });

  test("keeps press feedback distinct from desktop hover feedback", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1440", "Desktop fine-pointer interaction only");

    await enterApp(page);
    const menu = page.locator(".top-controls__menu");
    await menu.evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished));
    });

    await menu.hover();
    // Apple 风格：hover 无上浮（translateY ≈ 0），仅轻微放大
    await expect.poll(() => transformTranslateY(menu)).toBeGreaterThan(-0.1);
    await expect.poll(() => transformScale(menu)).toBeGreaterThan(1.0);

    await page.mouse.down();
    await expect.poll(() => transformScale(menu)).toBeLessThan(0.99);
    await page.mouse.up();
  });
});
