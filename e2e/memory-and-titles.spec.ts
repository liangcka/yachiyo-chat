import { expect, test, type Locator, type Page } from "@playwright/test";
import type { StreamChatRequest } from "../src/services/chat-client";
import { dismissOnboarding, enterApp } from "./helpers";

test.use({ serviceWorkers: "block" });

async function openMemory(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "菜单", exact: true }).click();
  await page.getByRole("button", { name: "记忆", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "设置中心" });
  await expect(panel).toBeVisible();
  return panel;
}

async function closeMemory(page: Page): Promise<void> {
  const panel = page.getByRole("dialog", { name: "设置中心" });
  await panel.getByRole("button", { name: "关闭菜单", exact: true }).click();
  await expect(panel).toBeHidden();
}

async function sendMessage(page: Page, text: string): Promise<void> {
  const replyCount = await page.getByRole("article", { name: "八千代的回复" }).count();
  await page.getByPlaceholder("什么都可以告诉我").fill(text);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("article", { name: "八千代的回复" })).toHaveCount(replyCount + 1);
  await expect(page.getByRole("article", { name: "八千代的回复" }).last()).toContainText(
    "笑着递上热乎乎的松饼",
  );
}

async function newConversation(page: Page): Promise<void> {
  await page.getByRole("button", { name: "菜单", exact: true }).click();
  await page.getByRole("button", { name: "新建对话", exact: true }).click();
  await expect(page.getByRole("article", { name: "八千代的回复" })).toHaveCount(0);
}

function metadataStream(title: string | null, memory: string | null): string {
  const text = JSON.stringify({ title, memory });
  return `event: delta\ndata: ${JSON.stringify({ text })}\n\nevent: done\ndata: {"truncated":false}\n\n`;
}

test("完整回复后自动生成标题并持久化到历史列表", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await enterApp(page);
  await sendMessage(page, "今天想聊聊日常");
  await page.getByRole("button", { name: "菜单", exact: true }).click();
  await page.getByRole("button", { name: "历史记录", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "历史记录" }).getByText("日常闲聊", { exact: true }))
    .toBeVisible({ timeout: 10_000 });

  await page.reload();
  await expect(page.getByPlaceholder("什么都可以告诉我")).toBeVisible();
  await page.getByRole("button", { name: "菜单", exact: true }).click();
  await page.getByRole("button", { name: "历史记录", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "历史记录" }).getByText("日常闲聊", { exact: true }))
    .toBeVisible();
  expect(errors).toEqual([]);
});

test("自动记忆合并更新，切换对话和刷新后仍可只读查看", async ({ page }, testInfo) => {
  const requests: StreamChatRequest[] = [];
  const metadataInputs: Array<{ generateTitle: boolean; updateMemory: boolean; existingMemory: string }> = [];
  const mergedMemories = ["喜欢绿茶。", "喜欢绿茶。\n住在东京。", "喜欢咖啡。\n住在东京。"];
  await page.route("**/api/chat", async (route) => {
    const request = route.request().postDataJSON() as StreamChatRequest;
    requests.push(request);
    if (request.mode !== "metadata") return route.continue();
    const input = JSON.parse(request.messages[0]!.text) as typeof metadataInputs[number];
    metadataInputs.push(input);
    await route.fulfill({
      contentType: "text/event-stream",
      body: metadataStream(
        input.generateTitle ? (metadataInputs.length <= 3 ? "饮品偏好" : "饮料推荐") : null,
        mergedMemories[metadataInputs.length - 1] ?? null,
      ),
    });
  });
  await enterApp(page);

  for (const [index, text] of ["我喜欢绿茶", "我喜欢绿茶，而且住在东京", "改一下，我现在喜欢咖啡"].entries()) {
    await sendMessage(page, text);
    const panel = await openMemory(page);
    await expect(panel.locator(".settings-memory__content")).toHaveText(mergedMemories[index]!);
    await closeMemory(page);
  }
  expect(metadataInputs).toEqual([
    { generateTitle: true, updateMemory: true, existingMemory: "" },
    { generateTitle: false, updateMemory: true, existingMemory: "喜欢绿茶。" },
    { generateTitle: false, updateMemory: true, existingMemory: "喜欢绿茶。\n住在东京。" },
  ]);

  await newConversation(page);
  let panel = await openMemory(page);
  await expect(panel.locator(".settings-memory__content")).toHaveText(mergedMemories[2]!);
  await closeMemory(page);
  await sendMessage(page, "给我推荐一种饮料");
  const chatRequest = requests.filter(({ mode }) => mode !== "metadata").at(-1);
  expect(chatRequest?.messages.some(({ text }) => text.includes(mergedMemories[2]!))).toBe(true);

  await page.getByRole("button", { name: "菜单", exact: true }).click();
  await page.getByRole("button", { name: "历史记录", exact: true }).click();
  const history = page.getByRole("dialog", { name: "历史记录" });
  await history.getByRole("button", { name: /饮品偏好/ }).click();
  await expect(history).toBeHidden();
  await expect(page.getByRole("article", { name: "八千代的回复" })).toHaveCount(3);
  panel = await openMemory(page);
  await expect(panel.locator(".settings-memory__content")).toHaveText(mergedMemories[2]!);
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("memory-readonly.png") });

  await expect(panel.getByRole("textbox")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: /保存记忆|清除记忆|撤销这次变更/ })).toHaveCount(0);
  await page.reload();
  await expect(page.getByPlaceholder("什么都可以告诉我")).toBeVisible();
  panel = await openMemory(page);
  await expect(panel.locator(".settings-memory__content")).toHaveText(mergedMemories[2]!);
});

test("清除全部本地数据同时清空长期记忆和聊天，刷新后保持为空", async ({ page }) => {
  await page.route("**/api/chat", async (route) => {
    const request = route.request().postDataJSON() as StreamChatRequest;
    if (request.mode !== "metadata") return route.continue();
    await route.fulfill({ contentType: "text/event-stream", body: metadataStream("周末散步", "喜欢周末散步。") });
  });
  await enterApp(page);
  await sendMessage(page, "喜欢周末散步");
  let panel = await openMemory(page);
  await expect(panel.locator(".settings-memory__content")).toHaveText("喜欢周末散步。");
  await closeMemory(page);

  await page.getByRole("button", { name: "菜单", exact: true }).click();
  await page.getByRole("button", { name: "清除本地数据", exact: true }).click();
  await page.getByRole("dialog", { name: "菜单", exact: true }).getByRole("button", { name: "确定", exact: true }).click();
  await expect(page.getByRole("article", { name: "八千代的回复" })).toHaveCount(0);
  panel = await openMemory(page);
  await expect(panel.getByText("还没有记住的内容。聊聊你的喜好，八千代会慢慢记住。", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByPlaceholder("什么都可以告诉我")).toBeVisible();
  await dismissOnboarding(page);
  panel = await openMemory(page);
  await expect(panel.getByText("还没有记住的内容。聊聊你的喜好，八千代会慢慢记住。", { exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: "八千代的回复" })).toHaveCount(0);
});
