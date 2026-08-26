import { expect, test, type Page } from "@playwright/test";

declare global {
  interface Window {
    /** longtask 采样结果（duration 毫秒数组）；内核不支持 PerformanceObserver longtask 时为 undefined */
    __perfLongTasks__: number[] | undefined;
  }
}

/**
 * web-perf lane：长对话性能回归防线。
 *
 * mock 模式流式为一次性事件，无稳定帧节奏，故不做帧率类断言；
 * 本 lane 聚焦三个可稳定测量的目标：
 * 1. 虚拟化：120 条消息在 DOM 中只保留可见窗口 + overscan 数量的气泡节点
 *    （P2-6 的回归防线，防止未来改动悄悄退回全量渲染）；
 * 2. 窗口化：初始加载只取最近 50 条历史，更早的 70 条留在 IndexedDB 中按需上翻；
 * 3. 交互期长任务：发送消息期间 main thread 无超阈值 long task（>200ms）。
 *
 * 运行：npm run test:perf（需先 npm run build，脚本内部已串联）
 */

const PERF_CONVERSATION_ID = "perf-conversation";
const TOTAL_MESSAGES = 120;
/** 与 use-chat-controller.ts 的 historyWindowSize 对齐 */
const HISTORY_WINDOW_SIZE = 50;

/** 测试期收集的控制台错误与页面异常（perf lane 兼作运行时报错防线） */
const consoleErrors: string[] = [];


async function enterApp(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("访问码").fill("yachiyo-local-access");
  await page.getByRole("button", { name: "进入" }).click();
  await expect(page.getByPlaceholder("什么都可以告诉我")).toBeVisible();
}

/** 只读探测：返回当前库里的会话 id 列表与消息总数，用于失败时的现场证据 */
async function readSeedState(page: Page): Promise<{
  conversationIds: string[];
  messageTotal: number;
}> {
  return page.evaluate(
    async (dbName) =>
      new Promise((resolve, reject) => {
        const openRequest = indexedDB.open(dbName);
        openRequest.onerror = () => reject(openRequest.error);
        openRequest.onsuccess = () => {
          const db = openRequest.result;
          const tx = db.transaction(["conversations", "messages"], "readonly");
          const idsRequest = tx.objectStore("conversations").getAll();
          const countRequest = tx.objectStore("messages").count();
          tx.oncomplete = () => {
            resolve({
              conversationIds: idsRequest.result.map((record) => record.id),
              messageTotal: countRequest.result,
            });
            db.close();
          };
        };
      }),
    "yachiyo-chat",
  );
}

async function seedDatabase(page: Page): Promise<void> {
  await page.goto("/yachiyo-mark.svg");
  await page.evaluate(
    async ({ conversationId, total }) => {
      await new Promise<void>((resolve, reject) => {
        const deleteReq = indexedDB.deleteDatabase("yachiyo-chat");
        deleteReq.onerror = () => reject(deleteReq.error);
        deleteReq.onsuccess = () => resolve();
        deleteReq.onblocked = () => resolve();
      });

      await new Promise<void>((resolve, reject) => {
        // Dexie version(2) 对应原生 IndexedDB version 20（Dexie 内部乘以 10）
        const request = indexedDB.open("yachiyo-chat", 20);
        request.onerror = () => reject(request.error);
        request.onupgradeneeded = () => {
          const db = request.result;
          const conversations = db.createObjectStore("conversations", { keyPath: "id" });
          conversations.createIndex("updatedAt", "updatedAt");
          conversations.createIndex("locale", "locale");
          const messages = db.createObjectStore("messages", { keyPath: "id" });
          messages.createIndex("conversationId", "conversationId");
          messages.createIndex("createdAt", "createdAt");
          messages.createIndex("[conversationId+createdAt]", ["conversationId", "createdAt"]);
          const images = db.createObjectStore("images", { keyPath: "id" });
          images.createIndex("conversationId", "conversationId");
          db.createObjectStore("settings", { keyPath: "key" });
          db.createObjectStore("llmSettings", { keyPath: "provider" });
        };
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(["conversations", "messages"], "readwrite");
          tx.onerror = () => reject(tx.error);
          const base = Date.now() - (total + 1) * 60_000;
          tx.objectStore("conversations").put({
            createdAt: base,
            id: conversationId,
            locale: "zh-CN",
            title: "性能测试会话",
            updatedAt: Date.now(),
          });
          for (let index = 0; index < total; index += 1) {
            const role = index % 2 === 0 ? "user" : "assistant";
            tx.objectStore("messages").put({
              conversationId,
              createdAt: base + index * 60_000,
              id: `perf-${index}`,
              role,
              status: "complete",
              text:
                role === "user"
                  ? `第 ${index} 条用户消息，用于撑起列表高度。`.repeat(2)
                  : `第 ${index} 条八千代的回复。（笑着递上热乎乎的松饼）`.repeat(3),
            });
          }
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      });
    },
    { conversationId: PERF_CONVERSATION_ID, total: TOTAL_MESSAGES },
  );
}

test.beforeEach(async ({ page }) => {
  consoleErrors.length = 0;
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));

  // 收集 long task（PerformanceObserver 阈值 >50ms；断言只对 >200ms 重任务报警）
  await page.addInitScript(() => {
    const samples: number[] = [];
    window.__perfLongTasks__ = samples;
    try {
      new PerformanceObserver((list) => {
        samples.push(...list.getEntries().map((entry) => entry.duration));
      }).observe({ entryTypes: ["longtask"] });
    } catch {
      // 内核不支持 longtask 时静默降级（对应断言自动跳过）
    }
  });
});

test("long conversation stays virtualized, windowed, and free of long tasks while sending", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-390", "单项目跑一次即可覆盖断言");

  await seedDatabase(page);
  await enterApp(page);

  // —— 种子落库校验：先确认数据确实写进了 IndexedDB，再谈渲染 ——
  const seedState = await readSeedState(page);
  expect(
    seedState,
    `种子未生效：conversations=${JSON.stringify(seedState.conversationIds)} messages=${seedState.messageTotal}`,
  ).toEqual({ conversationIds: [PERF_CONVERSATION_ID], messageTotal: TOTAL_MESSAGES });

  // —— 窗口化 + 虚拟化断言：DOM 气泡数必须远小于存储总量 ——
  // 可达名固定为「八千代的回复 / 我的消息」（见 MessageBubble.messageLabel），与消息内容无关。
  // 用等待式断言确保初始加载（IndexedDB → reducer → 渲染）完成后再计数：
  // locator.count() 不自动重试，过早取值会把“尚未渲染”误判为“没有数据”
  const assistantBubbles = page.getByRole("article", { name: "八千代的回复" });
  const userBubbles = page.getByRole("article", { name: "我的消息" });
  await expect(assistantBubbles.first()).toBeVisible();
  const assistantCount = await assistantBubbles.count();
  const userCount = await userBubbles.count();
  // 窗口化生效：最多加载最近 50 条（120 - 70）
  expect(userCount + assistantCount).toBeLessThanOrEqual(HISTORY_WINDOW_SIZE);
  // 虚拟化生效：实际渲染节点远小于窗口大小（视口 ~844px + overscan）
  expect(userCount + assistantCount).toBeLessThan(HISTORY_WINDOW_SIZE);

  // 发送消息触发完整交互链路（send → stream → persist → 折叠），期间统计 long task
  await page.getByPlaceholder("什么都可以告诉我").fill("今天有点累");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByRole("article", { name: "八千代的回复" }).last()).toContainText(
    "笑着递上热乎乎的松饼",
  );

  const longTasks = await page.evaluate(() => window.__perfLongTasks__);
  const heavyTasks = (longTasks ?? []).filter((duration) => duration > 200);
  if (longTasks !== undefined) {
    expect(
      heavyTasks,
      `交互期出现 ${heavyTasks.length} 个 >200ms 长任务：${JSON.stringify(heavyTasks)}`,
    ).toEqual([]);
  }

  // 控制台无错误（性能 lane 顺带守住运行时报错）
  expect(consoleErrors, `页面运行时报错：\n${consoleErrors.join("\n")}`).toEqual([]);
});
