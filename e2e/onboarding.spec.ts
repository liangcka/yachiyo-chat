import { expect, test } from "@playwright/test";
import { copyFor } from "../src/i18n/messages";
import { enterApp } from "./helpers";

test.use({ serviceWorkers: "block" });
const copy = copyFor("zh-CN");

test("首次引导完成后刷新不再显示，设置可以重看并前往默认模型", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await enterApp(page, { skipOnboarding: false });
  const guide = page.getByRole("dialog", { name: copy.onboardingTitle });
  await expect(guide).toBeVisible();
  await expect(guide.getByRole("button", { name: copy.onboardingSkip, exact: true })).toBeFocused();
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("onboarding-welcome.png") });
  await guide.getByRole("button", { name: copy.onboardingNext }).click();
  await expect(guide).toContainText("GLM-4.7-Flash");
  await guide.getByRole("button", { name: copy.onboardingBack }).click();
  await expect(guide).toContainText(copy.onboardingWelcomeTitle);
  await guide.getByRole("button", { name: copy.onboardingNext }).click();
  await guide.getByRole("button", { name: copy.onboardingNext }).click();
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("onboarding-features.png") });
  await guide.getByRole("button", { name: copy.onboardingStart }).click();
  await expect(guide).not.toBeVisible();
  await page.reload();
  await expect(page.getByPlaceholder("什么都可以告诉我")).toBeVisible();
  await expect(guide).not.toBeVisible();

  await page.getByRole("button", { name: "菜单", exact: true }).click();
  await page.getByRole("button", { name: copy.allSettings, exact: true }).click();
  await page.getByRole("button", { name: copy.onboardingEntry }).click();
  await expect(guide).toContainText(copy.onboardingWelcomeTitle);
  await expect(guide.getByRole("button", { name: copy.onboardingSkip, exact: true })).toBeFocused();
  await guide.getByRole("button", { name: copy.onboardingNext }).click();
  await guide.getByRole("button", { name: copy.onboardingNext }).click();
  await guide.getByRole("button", { name: copy.onboardingOpenSettings }).click();
  const settings = page.getByRole("dialog", { name: copy.allSettings });
  await expect(settings).toBeVisible();
  await expect(settings.getByLabel(copy.llmProvider, { exact: true })).toHaveValue("glm");
  await expect(settings.getByLabel(copy.llmModel, { exact: true })).toHaveValue("glm-4.7-flash");
  const models = await settings.getByLabel(copy.llmModel, { exact: true }).locator("option").allTextContents();
  expect(models.some((model) => /4\.6/.test(model))).toBe(false);
  expect(errors).toEqual([]);
});

test("跳过与 Escape 会记住引导状态", async ({ page }) => {
  await enterApp(page);
  const guide = page.getByRole("dialog", { name: copy.onboardingTitle });
  await page.reload();
  await expect(page.getByPlaceholder("什么都可以告诉我")).toBeVisible();
  await expect(guide).not.toBeVisible();
  await page.getByRole("button", { name: "菜单", exact: true }).click();
  await page.getByRole("button", { name: copy.allSettings, exact: true }).click();
  await page.getByRole("button", { name: copy.onboardingEntry }).click();
  await expect(guide).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(guide).not.toBeVisible();
  await expect(page.getByRole("button", { name: "菜单", exact: true })).toBeFocused();
  await page.reload();
  await expect(page.getByPlaceholder("什么都可以告诉我")).toBeVisible();
  await expect(guide).not.toBeVisible();
});

test("引导在窄屏与较矮视口中无横向溢出，末步按钮可操作", async ({ page }, testInfo) => {
  await enterApp(page, { skipOnboarding: false });
  const guide = page.getByRole("dialog", { name: copy.onboardingTitle });
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 568 });
    expect(await guide.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= window.innerWidth && rect.top >= 0 && rect.bottom <= window.innerHeight
        && element.scrollWidth <= element.clientWidth;
    })).toBe(true);
  }
  await page.setViewportSize({ width: 320, height: 480 });
  await guide.getByRole("button", { name: copy.onboardingNext }).click();
  await guide.getByRole("button", { name: copy.onboardingNext }).click();
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("onboarding-320.png") });
  await guide.getByRole("button", { name: copy.onboardingStart }).click();
  await expect(guide).not.toBeVisible();
});
