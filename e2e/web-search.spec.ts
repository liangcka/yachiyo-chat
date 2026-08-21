import { expect, test, type Page } from "@playwright/test";

/** 与 yachiyo-chat.spec.ts 保持一致的应用进入流程 */
async function enterApp(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("访问码").fill("yachiyo-local-access");
  await page.getByRole("button", { name: "进入" }).click();
  await expect(page.getByPlaceholder("什么都可以告诉我")).toBeVisible();
}

/** 通过 菜单 → 技能 入口打开技能面板 */
async function openSkillsPanel(page: Page): Promise<void> {
  await page.getByRole("button", { name: "菜单" }).click();
  await page.getByRole("button", { name: "技能" }).click();
  await expect(page.getByRole("dialog", { name: "技能" })).toBeVisible();
}

/** 点击面板右上角关闭按钮并等待面板完全收起（避免残留 overlay 拦截后续点击） */
async function closeSkillsPanel(page: Page): Promise<void> {
  // 菜单 drawer 关闭动画期间可能仍残留"关闭菜单"按钮，因此限定在技能面板内查找
  const panel = page.getByRole("dialog", { name: "技能" });
  await panel.getByRole("button", { name: "关闭菜单" }).click();
  await expect(panel).toBeHidden();
}

/** 发送一条消息并等待 mock 回复完整流出 */
async function sendAndAwaitMockReply(page: Page, text: string): Promise<void> {
  await page.getByPlaceholder("什么都可以告诉我").fill(text);
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByRole("article", { name: "八千代的回复" }).last()).toContainText(
    "笑着递上热乎乎的松饼",
  );
}

/** 收集浏览器控制台 error，供用例结尾断言（沿用现有用例模式） */
function collectConsoleErrors(page: Page): string[] {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  return consoleErrors;
}

test.describe("web search (mock)", () => {
  test("renders two bing sources under the reply when web search is on", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await enterApp(page);

    // 打开技能面板并开启联网搜索（显示引用来源默认开启）
    await openSkillsPanel(page);
    const webSearchToggle = page.getByRole("button", { name: "切换技能启用状态: 联网搜索" });
    await expect(webSearchToggle).toHaveAttribute("aria-pressed", "false");
    await webSearchToggle.click();
    await expect(webSearchToggle).toHaveAttribute("aria-pressed", "true");
    await closeSkillsPanel(page);

    await sendAndAwaitMockReply(page, "帮我查点资料");

    // 回复气泡下方应出现"参考来源"区块，含两条必应链接
    const reply = page.getByRole("article", { name: "八千代的回复" }).last();
    const sources = reply.locator('div[aria-label="参考来源"]');
    await expect(sources).toBeVisible();
    const links = sources.locator("a");
    await expect(links).toHaveCount(2);
    await expect(links.nth(0)).toHaveAttribute("href", "https://www.bing.com/");
    await expect(links.nth(0)).toHaveText("必应搜索结果一");
    await expect(links.nth(0)).toHaveAttribute("target", "_blank");
    await expect(links.nth(0)).toHaveAttribute("rel", "noopener noreferrer");
    await expect(links.nth(1)).toHaveAttribute("href", "https://cn.bing.com/");
    await expect(links.nth(1)).toHaveText("必应搜索结果二");
    await expect(links.nth(1)).toHaveAttribute("target", "_blank");
    await expect(links.nth(1)).toHaveAttribute("rel", "noopener noreferrer");

    expect(consoleErrors).toEqual([]);
  });

  test("hides the sources block when show sources is turned off", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await enterApp(page);

    await openSkillsPanel(page);
    // 开启联网搜索后，"显示引用来源"开关才可交互，再将其关闭
    const webSearchToggle = page.getByRole("button", { name: "切换技能启用状态: 联网搜索" });
    await webSearchToggle.click();
    await expect(webSearchToggle).toHaveAttribute("aria-pressed", "true");
    const showSourcesToggle = page.getByRole("button", {
      name: "切换技能启用状态: 显示引用来源",
    });
    await expect(showSourcesToggle).toHaveAttribute("aria-pressed", "true");
    await showSourcesToggle.click();
    await expect(showSourcesToggle).toHaveAttribute("aria-pressed", "false");
    await closeSkillsPanel(page);

    await sendAndAwaitMockReply(page, "再帮我查点别的");

    // 回复正常流出，但气泡下方不渲染"参考来源"区块
    const reply = page.getByRole("article", { name: "八千代的回复" }).last();
    await expect(reply.locator('div[aria-label="参考来源"]')).toHaveCount(0);

    expect(consoleErrors).toEqual([]);
  });

  test("keeps the chat plain and the show-sources toggle disabled while web search is off", async ({
    page,
  }) => {
    const consoleErrors = collectConsoleErrors(page);
    await enterApp(page);

    await openSkillsPanel(page);
    const webSearchToggle = page.getByRole("button", { name: "切换技能启用状态: 联网搜索" });
    await expect(webSearchToggle).toHaveAttribute("aria-pressed", "false");
    // 联网搜索关闭时，"显示引用来源"开关应处于 disabled 状态
    const showSourcesToggle = page.getByRole("button", {
      name: "切换技能启用状态: 显示引用来源",
    });
    await expect(showSourcesToggle).toBeDisabled();
    await expect(showSourcesToggle).toHaveAttribute("aria-pressed", "true");
    await closeSkillsPanel(page);

    await sendAndAwaitMockReply(page, "随便聊聊");

    // 回复正常流出，且无"参考来源"区块
    const reply = page.getByRole("article", { name: "八千代的回复" }).last();
    await expect(reply.locator('div[aria-label="参考来源"]')).toHaveCount(0);

    expect(consoleErrors).toEqual([]);
  });
});
