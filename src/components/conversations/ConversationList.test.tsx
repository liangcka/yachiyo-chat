import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Conversation } from "../../domain/chat";
import type { ConversationSearchResult } from "../../domain/conversation-search";
import { copyFor } from "../../i18n/messages";
import { ConversationList, type ConversationListProps } from "./ConversationList";

const now = new Date(2026, 9, 31, 15, 30).getTime();
const at = (day: number, hour = 12) => new Date(2026, 9, day, hour).getTime();

const conversations: Conversation[] = [
  { id: "first", title: "旅行计划", locale: "zh-CN", createdAt: 1, updatedAt: 3 },
  { id: "second", title: "咖啡时间", locale: "zh-CN", createdAt: 2, updatedAt: 4 },
];

function props(overrides: Partial<ConversationListProps> = {}): ConversationListProps {
  return {
    active: true,
    conversations,
    copy: copyFor("zh-CN"),
    now,
    onDelete: vi.fn(async () => undefined),
    onRename: vi.fn(async () => undefined),
    onSelect: vi.fn(),
    ...overrides,
  };
}

describe("会话列表", () => {
  it("无搜索回调时仍筛选标题，清空搜索恢复全部对话", () => {
    render(<ConversationList {...props()} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索对话" }), { target: { value: "旅行" } });
    expect(screen.getByRole("button", { name: /旅行计划/u })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /咖啡时间/u })).not.toBeInTheDocument();
    expect(screen.getByText("旅行", { selector: "mark" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除搜索" }));
    expect(screen.getByRole("button", { name: /咖啡时间/u })).toBeInTheDocument();
  });

  it("显示正文片段并沿用选择对话的回调", async () => {
    const listProps = props({
      onSearch: vi.fn(async (): Promise<ConversationSearchResult[]> => [{
        conversation: conversations[0]!,
        message: { id: "old", role: "user", text: "想去京都看樱花", createdAt: 1 },
      }]),
    });
    render(<ConversationList {...listProps} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "京都" } });
    const result = await screen.findByRole("button", { name: /想去京都看樱花/u });
    expect(screen.getByText("京都", { selector: "mark" })).toBeInTheDocument();
    fireEvent.click(result);
    expect(listProps.onSelect).toHaveBeenCalledWith("first");
  });

  it("旧查询晚返回时不覆盖新查询结果", async () => {
    let finishOld: ((value: ConversationSearchResult[]) => void) | undefined;
    const onSearch = vi.fn((query: string): Promise<ConversationSearchResult[]> => query === "旧"
      ? new Promise((resolve) => { finishOld = resolve; })
      : Promise.resolve([{ conversation: conversations[1]! }]));
    render(<ConversationList {...props({ onSearch })} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "旧" } });
    await waitFor(() => expect(onSearch).toHaveBeenCalledWith("旧"));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "咖啡" } });
    await screen.findByRole("button", { name: /咖啡时间/u });
    await act(async () => finishOld?.([{ conversation: conversations[0]! }]));
    expect(screen.queryByRole("button", { name: /旅行计划/u })).not.toBeInTheDocument();
  });

  it("所在弹层关闭后忽略未完成查询，重新打开可以重新查询", async () => {
    let finish: ((value: ConversationSearchResult[]) => void) | undefined;
    const onSearch = vi.fn(() => new Promise<ConversationSearchResult[]>((resolve) => { finish = resolve; }));
    const listProps = props({ onSearch });
    const { rerender } = render(<ConversationList {...listProps} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "京都" } });
    await waitFor(() => expect(onSearch).toHaveBeenCalledOnce());
    rerender(<ConversationList {...listProps} active={false} />);
    await act(async () => finish?.([{ conversation: conversations[0]! }]));
    rerender(<ConversationList {...listProps} active />);
    await waitFor(() => expect(onSearch).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button", { name: /旅行计划/u })).not.toBeInTheDocument();
  });

  it("区分无结果与错误，并允许重试", async () => {
    const onSearch = vi.fn<(query: string) => Promise<ConversationSearchResult[]>>()
      .mockRejectedValueOnce(new Error("读取失败"))
      .mockResolvedValueOnce([]);
    render(<ConversationList {...props({ onSearch })} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "京都" } });
    expect(await screen.findByText("搜索失败，请重试。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新搜索" }));
    expect(await screen.findByText("没有找到相关对话")).toBeInTheDocument();
  });

  it("按今天、昨天、最近 7 天与更早分组，组内保持更新时间倒序", () => {
    const dated: Conversation[] = [
      { id: "a", title: "早安", locale: "zh-CN", createdAt: 1, updatedAt: at(31, 9) },
      { id: "b", title: "夜聊", locale: "zh-CN", createdAt: 1, updatedAt: at(30, 23) },
      { id: "c", title: "周末计划", locale: "zh-CN", createdAt: 1, updatedAt: at(27) },
      { id: "d", title: "初次见面", locale: "zh-CN", createdAt: 1, updatedAt: at(20) },
      { id: "e", title: "更久之前", locale: "zh-CN", createdAt: 1, updatedAt: at(2) },
    ];
    render(<ConversationList {...props({ conversations: dated })} />);

    const groups = screen.getAllByRole("group");
    expect(groups.map((group) => within(group).getByRole("heading").textContent))
      .toEqual(["今天", "昨天", "最近 7 天", "更早"]);
    expect(within(screen.getByRole("group", { name: "今天" })).getByRole("button", { name: /早安/u }))
      .toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "最近 7 天" })).getAllByRole("listitem")).toHaveLength(1);
    expect(within(screen.getByRole("group", { name: "更早" })).getAllByRole("listitem").map((item) =>
      within(item).getByRole("button", { name: /初次见面|更久之前/u }).textContent?.includes("初次见面")))
      .toEqual([true, false]);
  });

  it("标记当前会话，并在二次确认后才删除", () => {
    const listProps = props({ activeId: "second" });
    render(<ConversationList {...listProps} />);
    expect(screen.getByRole("button", { name: /咖啡时间/u })).toHaveAttribute("aria-current", "true");

    const item = screen.getByRole("button", { name: /旅行计划/u }).closest("li")!;
    fireEvent.click(within(item).getByRole("button", { name: "删除" }));
    expect(listProps.onDelete).not.toHaveBeenCalled();
    fireEvent.click(within(item).getByRole("button", { name: "确定" }));
    expect(listProps.onDelete).toHaveBeenCalledWith("first");
  });
});
