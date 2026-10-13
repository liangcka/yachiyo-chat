import { expect, test, type Page } from "@playwright/test";
import { enterApp } from "./helpers";
import { copyFor } from "../src/i18n/messages";
import type { StreamChatRequest } from "../src/services/chat-client";

test.use({ serviceWorkers: "block" });
const copy = copyFor("zh-CN");

async function openSettings(page: Page): Promise<void> {
  await page.getByRole("button", { name: "菜单", exact: true }).click();
  await page.getByRole("button", { name: "设置中心", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "设置中心" })).toBeVisible();
}

test("四个二级界面使用原版分段导航，窄屏与桌面均可切换", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await enterApp(page);
  await openSettings(page);
  const panel = page.getByRole("dialog", { name: "设置中心" });
  const tabs = panel.getByRole("tab");
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    for (let index = 0; index < 4; index += 1) {
      await tabs.nth(index).click();
      // 在静止布局下测量，悬停缩放单独由动效测试覆盖。
      await page.mouse.move(0, 0);
      await expect(tabs.nth(index)).toHaveAttribute("aria-selected", "true");
      if (index === 0) await expect(panel.locator(".llm-panel__active")).toBeVisible();
      await expect(panel.getByRole("tabpanel")).toBeVisible();
      await expect.poll(() => panel.evaluate((element) => {
        const body = element.querySelector<HTMLElement>(".settings-panel__body")!;
        const nav = element.querySelector<HTMLElement>(".settings-panel__tabs")!;
        return {
          bodyFits: body.scrollWidth <= body.clientWidth,
          segmented: getComputedStyle(nav).display === "flex" && [...nav.children].every((tab) =>
            getComputedStyle(tab).flexDirection === "row" && getComputedStyle(tab).borderRadius !== "50%"),
          selectedVisible: (() => {
            const selected = nav.querySelector('[aria-selected="true"]')!.getBoundingClientRect();
            const parent = nav.getBoundingClientRect();
            return selected.left >= parent.left && selected.right <= parent.right;
          })(),
        };
      })).toEqual({ bodyFits: true, segmented: true, selectedVisible: true });
      if (width === 390) await page.screenshot({ animations: "disabled", path: testInfo.outputPath(`settings-${index}.png`) });
    }
  }
  expect(errors).toEqual([]);
});

test("模型配置保存后回填，偏好联动与技能展开可操作", async ({ page }) => {
  await enterApp(page);
  await openSettings(page);
  const panel = page.getByRole("dialog", { name: "设置中心" });
  await panel.locator(".custom-select__trigger").nth(0).click();
  await panel.getByRole("listbox").getByRole("option", { name: "DeepSeek", exact: true }).click();
  await panel.locator(".custom-select__trigger").nth(1).click();
  await panel.getByRole("listbox").getByRole("option", { name: "deepseek-v4-pro", exact: true }).click();
  await panel.getByLabel("API Key", { exact: true }).fill("sk-settings-ui-test-key");
  await panel.getByRole("button", { name: copy.llmSave, exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText(copy.llmSaved);
  await panel.getByRole("tab", { name: "聊天偏好" }).click();
  const smart = panel.getByRole("button", { name: `${copy.skillToggleLabel}: ${copy.webSearchSmart}` });
  await expect(smart).toBeDisabled();
  await panel.getByRole("button", { name: "切换技能启用状态: 联网搜索" }).click();
  await expect(smart).toBeEnabled();
  await panel.getByRole("tab", { name: /技能/ }).click();
  await panel.getByRole("button", { name: new RegExp(`${copy.skillViewContent}:`) }).first().click();
  await expect(panel.locator("pre")).toBeVisible();
  await panel.getByRole("tab", { name: "LLM 设置" }).click();
  await expect(panel.getByLabel("API Key", { exact: true })).toHaveValue("sk-settings-ui-test-key");
  await expect(panel.getByLabel("模型", { exact: true })).toHaveValue("deepseek-v4-pro");
});

test("GLM 推荐 charGLM-4，GLM-4.7-Flash 无 Key 保存并使用服务端聊天", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await enterApp(page);
  await openSettings(page);
  const panel = page.getByRole("dialog", { name: "设置中心" });
  const modelTrigger = panel.locator(".custom-select__trigger").nth(1);
  await modelTrigger.click();
  const charGlm = panel.getByRole("listbox").getByRole("option", { name: /charGLM-4/ });
  await expect(charGlm).toContainText(copy.llmRecommended);
  await charGlm.click();
  await expect(panel.getByLabel("API Key", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: copy.llmSave, exact: true })).toBeDisabled();
  await modelTrigger.click();
  await panel.getByRole("listbox").getByRole("option", { name: /GLM-4\.7-Flash/ }).click();
  await expect(panel.getByLabel("API Key", { exact: true })).toHaveCount(0);
  await expect(panel.getByText(copy.llmServerManagedHint)).toBeVisible();
  await panel.getByRole("button", { name: copy.llmSave, exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText(copy.llmSaved);
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("glm-server-model.png") });
  await panel.getByRole("button", { name: "关闭菜单", exact: true }).click();
  await expect(panel).toBeHidden();

  await page.reload();
  await expect(page.getByPlaceholder("什么都可以告诉我")).toBeVisible();
  const chatRequest = page.waitForRequest((request) =>
    new URL(request.url()).pathname === "/api/chat" &&
    (request.postDataJSON() as StreamChatRequest).mode === undefined,
  );
  await page.getByPlaceholder("什么都可以告诉我").fill("今天有点累");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const payload = (await chatRequest).postDataJSON() as StreamChatRequest;
  expect(payload).not.toHaveProperty("provider");
  expect(payload).not.toHaveProperty("apiKey");
  expect(payload).not.toHaveProperty("model");
  await expect(page.getByRole("article", { name: "八千代的回复" }).last()).toContainText("笑着递上热乎乎的松饼");
  expect(errors).toEqual([]);
});

test("日语窄屏标签与内容无横向溢出", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await enterApp(page);
  await page.getByRole("button", { name: "菜单", exact: true }).click();
  await page.getByRole("button", { name: "日本語", exact: true }).click();
  await page.getByRole("button", { name: "設定センター", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "設定センター" });
  for (const tab of await panel.getByRole("tab").all()) {
    await tab.click();
    expect(await panel.getByRole("tabpanel").evaluate((body) => body.scrollWidth <= body.clientWidth)).toBe(true);
  }
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("settings-ja-320.png") });
});
