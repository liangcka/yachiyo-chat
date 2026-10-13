import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Conversation } from "../domain/chat";
import type { ConversationSearchResult } from "../domain/conversation-search";
import { copyFor } from "../i18n/messages";
import { HistoryPanel, type HistoryPanelProps } from "./HistoryPanel";

const conversations: Conversation[] = [
  { id: "first", title: "旅行计划", locale: "zh-CN", createdAt: 1, updatedAt: 3 },
  { id: "second", title: "咖啡时间", locale: "zh-CN", createdAt: 2, updatedAt: 4 },
];

function props(overrides: Partial<HistoryPanelProps> = {}): HistoryPanelProps {
  return {
    conversations,
    copy: copyFor("zh-CN"),
    open: true,
    onClose: vi.fn(),
    onDelete: vi.fn(async () => undefined),
    onRename: vi.fn(async () => undefined),
    onSelect: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("历史搜索面板", () => {
  it("无搜索回调时仍筛选标题，清空搜索恢复全部对话", () => {
    render(<HistoryPanel {...props()} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索对话" }), { target: { value: "旅行" } });
    expect(screen.getByRole("button", { name: /旅行计划/u })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /咖啡时间/u })).not.toBeInTheDocument();
    expect(screen.getByText("旅行", { selector: "mark" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除搜索" }));
    expect(screen.getByRole("button", { name: /咖啡时间/u })).toBeInTheDocument();
  });

  it("显示正文片段并沿用选择对话的回调", async () => {
    const panelProps = props({
      onSearch: vi.fn(async (): Promise<ConversationSearchResult[]> => [{
        conversation: conversations[0]!,
        message: { id: "old", role: "user", text: "想去京都看樱花", createdAt: 1 },
      }]),
    });
    render(<HistoryPanel {...panelProps} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "京都" } });
    const result = await screen.findByRole("button", { name: /想去京都看樱花/u });
    expect(screen.getByText("京都", { selector: "mark" })).toBeInTheDocument();
    fireEvent.click(result);
    expect(panelProps.onSelect).toHaveBeenCalledWith("first");
    expect(panelProps.onClose).toHaveBeenCalledOnce();
  });

  it("旧查询晚返回时不覆盖新查询结果", async () => {
    let finishOld: ((value: ConversationSearchResult[]) => void) | undefined;
    const onSearch = vi.fn((query: string): Promise<ConversationSearchResult[]> => query === "旧"
      ? new Promise((resolve) => { finishOld = resolve; })
      : Promise.resolve([{ conversation: conversations[1]! }]));
    render(<HistoryPanel {...props({ onSearch })} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "旧" } });
    await waitFor(() => expect(onSearch).toHaveBeenCalledWith("旧"));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "咖啡" } });
    await screen.findByRole("button", { name: /咖啡时间/u });
    await act(async () => finishOld?.([{ conversation: conversations[0]! }]));
    expect(screen.queryByRole("button", { name: /旅行计划/u })).not.toBeInTheDocument();
  });

  it("关闭后忽略未完成查询，重新打开可以重新查询", async () => {
    let finish: ((value: ConversationSearchResult[]) => void) | undefined;
    const onSearch = vi.fn(() => new Promise<ConversationSearchResult[]>((resolve) => { finish = resolve; }));
    const panelProps = props({ onSearch });
    const { rerender } = render(<HistoryPanel {...panelProps} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "京都" } });
    await waitFor(() => expect(onSearch).toHaveBeenCalledOnce());
    rerender(<HistoryPanel {...panelProps} open={false} />);
    await act(async () => finish?.([{ conversation: conversations[0]! }]));
    rerender(<HistoryPanel {...panelProps} open />);
    await waitFor(() => expect(onSearch).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button", { name: /旅行计划/u })).not.toBeInTheDocument();
  });

  it("区分无结果与错误，并允许重试", async () => {
    const onSearch = vi.fn<(query: string) => Promise<ConversationSearchResult[]>>()
      .mockRejectedValueOnce(new Error("读取失败"))
      .mockResolvedValueOnce([]);
    render(<HistoryPanel {...props({ onSearch })} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "京都" } });
    expect(await screen.findByText("搜索失败，请重试。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新搜索" }));
    expect(await screen.findByText("没有找到相关对话")).toBeInTheDocument();
  });
});
