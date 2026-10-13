import { expect, test, type Locator, type Page } from "@playwright/test";
import type { StreamChatRequest } from "../src/services/chat-client";
import { enterApp } from "./helpers";

test.use({ serviceWorkers: "block" });

async function openMemory(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "菜单", exact: true }).click();
  await page.getByRole("button", { name: "记忆", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "设置中心" });
  await expect(panel).toBeVisible();
  return panel;
}

async function sendMessage(page: Page, text: string): Promise<void> {
  await page.getByPlaceholder("什么都可以告诉我").fill(text);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("article", { name: "八千代的回复" }).last())
    .toContainText("笑着递上热乎乎的松饼");
  await expect(page.getByRole("article", { name: "八千代的回复" }).last())
    .toHaveAttribute("data-status", "complete");
}

function metadataStream(title: string | null, memory: string | null): string {
  return `event: delta\ndata: ${JSON.stringify({ text: JSON.stringify({ title, memory }) })}\n\nevent: done\ndata: {"truncated":false}\n\n`;
}

test("记忆只读展示自动记忆，刷新后保留内容", async ({ page }, testInfo) => {
  await page.route("**/api/chat", async (route) => {
    const request = route.request().postDataJSON() as StreamChatRequest;
    if (request.mode !== "metadata") return route.continue();
    await route.fulfill({ contentType: "text/event-stream", body: metadataStream("饮品偏好", "喜欢绿茶。") });
  });
  await enterApp(page);
  await sendMessage(page, "我喜欢绿茶");
  let panel = await openMemory(page);
  await expect(panel.locator(".settings-memory__content")).toHaveText("喜欢绿茶。");
  await expect(panel.getByRole("textbox")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: /保存记忆|清除记忆|撤销这次变更/ })).toHaveCount(0);
  await expect(panel.getByRole("region", { name: "记忆变更记录" })).toHaveCount(0);
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("memory-readonly.png") });

  await page.reload();
  await expect(page.getByPlaceholder("什么都可以告诉我")).toBeVisible();
  panel = await openMemory(page);
  await expect(panel.locator(".settings-memory__content")).toHaveText("喜欢绿茶。");
});

test("消息菜单主动记住完整用户消息并记录来源", async ({ page }, testInfo) => {
  const requests: StreamChatRequest[] = [];
  await page.route("**/api/chat", async (route) => {
    const request = route.request().postDataJSON() as StreamChatRequest;
    if (request.mode !== "metadata") return route.continue();
    requests.push(request);
    const assistant = JSON.parse(request.messages[2]!.text) as { assistantText: string };
    await route.fulfill({
      contentType: "text/event-stream",
      body: metadataStream(assistant.assistantText ? "周末散步" : null,
        assistant.assistantText ? null : "喜欢周末去河边散步。"),
    });
  });
  await enterApp(page);
  await sendMessage(page, "我喜欢周末去河边散步");
  await expect.poll(() => requests.length).toBe(1);
  const message = page.getByRole("article", { name: "我的消息", exact: true });
  if (testInfo.project.name === "mobile-390") await message.click({ delay: 500 });
  else await message.click({ button: "right" });
  await page.getByRole("menuitem", { name: "记住这件事", exact: true }).click();
  await expect(page.getByText("长期记忆已保存", { exact: true })).toBeVisible();
  expect(JSON.parse(requests[1]!.messages[0]!.text)).toMatchObject({ generateTitle: false, updateMemory: true });
  expect(JSON.parse(requests[1]!.messages[1]!.text)).toEqual({ userText: "我喜欢周末去河边散步" });
  const panel = await openMemory(page);
  await expect(panel.locator(".settings-memory__content")).toHaveText("喜欢周末去河边散步。");
  await expect(panel.getByRole("region", { name: "记忆变更记录" })).toHaveCount(0);
});

test("撤回已记住的消息后恢复此前记忆，刷新和下一轮聊天均不再使用撤回事实", async ({ page }, testInfo) => {
  const requests: StreamChatRequest[] = [];
  let metadataCount = 0;
  await page.route("**/api/chat", async (route) => {
    const request = route.request().postDataJSON() as StreamChatRequest;
    requests.push(request);
    if (request.mode !== "metadata") return route.continue();
    metadataCount += 1;
    await route.fulfill({
      contentType: "text/event-stream",
      body: metadataStream(metadataCount === 1 ? "饮品偏好" : null,
        metadataCount === 1 ? "喜欢绿茶。" : metadataCount === 2 ? "喜欢绿茶。\n喜欢草莓。" : null),
    });
  });
  await enterApp(page);
  await sendMessage(page, "我喜欢绿茶");
  let panel = await openMemory(page);
  await expect(panel.locator(".settings-memory__content")).toHaveText("喜欢绿茶。");
  await panel.getByRole("button", { name: "关闭菜单", exact: true }).click();
  await expect(panel).toBeHidden();

  await sendMessage(page, "记住我喜欢草莓");
  panel = await openMemory(page);
  await expect(panel.locator(".settings-memory__content")).toHaveText("喜欢绿茶。\n喜欢草莓。");
  await panel.getByRole("button", { name: "关闭菜单", exact: true }).click();
  await expect(panel).toBeHidden();
  const message = page.getByRole("article", { name: "我的消息", exact: true }).last();
  if (testInfo.project.name === "mobile-390") await message.click({ delay: 500 });
  else await message.click({ button: "right" });
  await page.getByRole("menuitem", { name: "撤回", exact: true }).click();
  await expect(page.getByRole("article", { name: "我的消息", exact: true })).toHaveCount(1);
  panel = await openMemory(page);
  await expect(panel.locator(".settings-memory__content")).toHaveText("喜欢绿茶。");

  await page.reload();
  await expect(page.getByPlaceholder("什么都可以告诉我")).toBeVisible();
  panel = await openMemory(page);
  await expect(panel.locator(".settings-memory__content")).toHaveText("喜欢绿茶。");
  await panel.getByRole("button", { name: "关闭菜单", exact: true }).click();
  await expect(panel).toBeHidden();
  await sendMessage(page, "还记得什么");
  const lastRequest = requests.filter(({ mode }) => mode !== "metadata").at(-1)!;
  expect(lastRequest.messages.some(({ text }) => text.includes("喜欢绿茶"))).toBe(true);
  expect(lastRequest.messages.some(({ text }) => text.includes("草莓"))).toBe(false);
});

test("搜索标题以外的旧消息，展示命中片段并打开所属对话", async ({ page }, testInfo) => {
  const errors: string[] = [];
  let metadataCount = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/chat", async (route) => {
    const request = route.request().postDataJSON() as StreamChatRequest;
    if (request.mode !== "metadata") return route.continue();
    const { userText } = JSON.parse(request.messages[1]!.text) as { userText: string };
    await route.fulfill({
      contentType: "text/event-stream",
      body: metadataStream(userText.includes("京都") ? "旅行旧事" : "晚饭安排", null),
    });
    metadataCount += 1;
  });
  await enterApp(page);
  await sendMessage(page, "去年在京都散步时看到了樱花");
  await expect.poll(() => metadataCount).toBe(1);
  await page.getByRole("button", { name: "菜单", exact: true }).click();
  await page.getByRole("button", { name: "新建对话", exact: true }).click();
  await expect(page.getByRole("article", { name: "我的消息", exact: true })).toHaveCount(0);
  await sendMessage(page, "今晚吃什么");
  await expect.poll(() => metadataCount).toBe(2);
  await page.getByRole("button", { name: "菜单", exact: true }).click();
  await page.getByRole("button", { name: "历史记录", exact: true }).click();
  const history = page.getByRole("dialog", { name: "历史记录" });
  const query = history.getByRole("searchbox", { name: "搜索对话" });
  await query.fill("京都");
  const result = history.getByRole("button", { name: /旅行旧事.*去年在京都散步时看到了樱花/u });
  await expect(result).toBeVisible();
  await expect(result.locator("mark")).toHaveText("京都");
  await expect(history.getByText("晚饭安排", { exact: true })).toBeHidden();
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("history-search.png") });
  await query.fill("__不存在的内容__");
  await expect(history.getByText("没有找到相关对话", { exact: true })).toBeVisible();
  await history.getByRole("button", { name: "清除搜索", exact: true }).click();
  await expect(history.getByText("晚饭安排", { exact: true })).toBeVisible();
  await query.fill("京都");
  await result.click();
  await expect(history).toBeHidden();
  await expect(page.getByRole("article", { name: "我的消息", exact: true }).locator("p"))
    .toHaveText("去年在京都散步时看到了樱花");
  expect(errors).toEqual([]);
});

for (const target of ["较早", "当前"] as const) {
  test(`删除${target}聊天后同步清理来源记忆，刷新与后续请求不再包含已删事实`, async ({ page }) => {
    const requests: StreamChatRequest[] = [];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/chat", async (route) => {
      const request = route.request().postDataJSON() as StreamChatRequest;
      requests.push(request);
      if (request.mode !== "metadata") return route.continue();
      const { userText } = JSON.parse(request.messages[1]!.text) as { userText: string };
      await route.fulfill({ contentType: "text/event-stream", body: metadataStream(
        userText === "我喜欢草莓" ? "水果偏好" : userText === "我喜欢绿茶" ? "饮品偏好" : null,
        userText === "我喜欢草莓" ? "喜欢草莓。" : userText === "我喜欢绿茶" ? "喜欢绿茶。" : null,
      ) });
    });
    await enterApp(page);
    await sendMessage(page, "我喜欢草莓");
    let memory = await openMemory(page);
    await expect(memory.locator(".settings-memory__content")).toHaveText("喜欢草莓。");
    await memory.getByRole("button", { name: "关闭菜单", exact: true }).click();
    await expect(memory).toBeHidden();
    await page.getByRole("button", { name: "菜单", exact: true }).click();
    await page.getByRole("button", { name: "新建对话", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "菜单", exact: true })).toBeHidden();
    await expect(page.getByRole("article", { name: "八千代的回复" })).toHaveCount(0);
    await sendMessage(page, "我喜欢绿茶");
    memory = await openMemory(page);
    await expect(memory.locator(".settings-memory__content")).toHaveText("喜欢草莓。\n喜欢绿茶。");
    await memory.getByRole("button", { name: "关闭菜单", exact: true }).click();
    await expect(memory).toBeHidden();
    const secondMetadata = requests.filter(({ mode }) => mode === "metadata")[1]!;
    expect(JSON.parse(secondMetadata.messages[0]!.text)).toMatchObject({ existingMemory: "" });

    await page.getByRole("button", { name: "菜单", exact: true }).click();
    await page.getByRole("button", { name: "历史记录", exact: true }).click();
    const history = page.getByRole("dialog", { name: "历史记录" });
    const removedTitle = target === "较早" ? "水果偏好" : "饮品偏好";
    const item = history.getByRole("listitem").filter({ hasText: removedTitle });
    await item.getByRole("button", { name: "删除", exact: true }).click();
    await item.getByRole("button", { name: "确定", exact: true }).click();
    await expect(history.getByText(removedTitle, { exact: true })).toHaveCount(0);
    await history.getByRole("button", { name: "关闭菜单", exact: true }).click();
    await expect(history).toBeHidden();
    const expectedMemory = target === "较早" ? "喜欢绿茶。" : "喜欢草莓。";
    memory = await openMemory(page);
    await expect(memory.locator(".settings-memory__content")).toHaveText(expectedMemory);
    await page.reload();
    await expect(page.getByPlaceholder("什么都可以告诉我")).toBeVisible();
    memory = await openMemory(page);
    await expect(memory.locator(".settings-memory__content")).toHaveText(expectedMemory);
    await memory.getByRole("button", { name: "关闭菜单", exact: true }).click();
    await expect(memory).toBeHidden();
    await sendMessage(page, "还记得什么");
    const last = requests.filter(({ mode }) => mode !== "metadata").at(-1)!;
    expect(last.messages.some(({ text }) => text.includes(target === "较早" ? "草莓" : "绿茶"))).toBe(false);
    expect(last.messages.some(({ text }) => text.includes(expectedMemory))).toBe(true);
    expect(errors).toEqual([]);
  });
}
