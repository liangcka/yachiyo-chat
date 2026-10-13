import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { copyFor } from "../i18n/messages";
import { UserMemoryEditor } from "./UserMemoryEditor";

const copy = copyFor("zh-CN");

describe("长期记忆编辑器", () => {
  it("显示变更来源和前后内容，只有最新记录可撤销", () => {
    const history = [
      { id: "latest", createdAt: 2, before: "喜欢绿茶", after: "喜欢咖啡", source: "automatic" as const },
      { id: "older", createdAt: 1, before: "", after: "喜欢绿茶", source: "message" as const },
    ];
    render(<UserMemoryEditor copy={copy} memory="喜欢咖啡" onSave={vi.fn(async () => true)} history={history} onUndo={vi.fn(async () => true)} />);
    const region = screen.getByRole("region", { name: "记忆变更记录" });
    expect(within(region).getByText("自动整理")).toBeInTheDocument();
    expect(within(region).getByText("主动记住")).toBeInTheDocument();
    const details = within(region).getAllByRole("group");
    expect(details[0]).toHaveTextContent("变更前喜欢绿茶变更后喜欢咖啡");
    expect(details[1]).toHaveTextContent("空记忆");
    expect(within(region).getAllByRole("button", { name: "撤销这次变更" })).toHaveLength(1);
  });

  it("撤销期间阻止重复操作，失败提示且保留未保存的草稿", async () => {
    let finish!: (saved: boolean) => void;
    const onUndo = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    render(<UserMemoryEditor
      copy={copy}
      memory="喜欢咖啡"
      onSave={vi.fn(async () => true)}
      history={[{ id: "latest", createdAt: 2, before: "喜欢绿茶", after: "喜欢咖啡", source: "automatic" }]}
      onUndo={onUndo}
    />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "正在编辑" } });
    const undo = screen.getByRole("button", { name: "撤销这次变更" });
    fireEvent.click(undo);
    fireEvent.click(undo);
    expect(onUndo).toHaveBeenCalledOnce();
    expect(onUndo).toHaveBeenCalledWith("latest");
    expect(screen.getByRole("button", { name: copy.userMemorySave })).toBeDisabled();
    await act(async () => { finish(false); });
    expect(screen.getByRole("alert")).toHaveTextContent("无法撤销");
    expect(screen.getByRole("textbox")).toHaveValue("正在编辑");
  });

  it("撤销成功后的记忆同步仍然保留脏草稿，并显示空历史", async () => {
    const onUndo = vi.fn(async () => true);
    const props = {
      copy,
      history: [{ id: "latest", createdAt: 2, before: "喜欢绿茶", after: "喜欢咖啡", source: "manual" as const }],
      onUndo,
      onSave: vi.fn(async () => true),
    };
    const { rerender } = render(<UserMemoryEditor {...props} memory="喜欢咖啡" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "我的草稿" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "撤销这次变更" })); });
    rerender(<UserMemoryEditor {...props} history={[]} memory="喜欢绿茶" />);
    expect(screen.getByRole("textbox")).toHaveValue("我的草稿");
    expect(screen.getByText("还没有记忆变更记录")).toBeInTheDocument();
  });

  it("自动更新不会覆盖正在编辑的草稿", () => {
    const onSave = vi.fn(async () => true);
    const { rerender } = render(<UserMemoryEditor copy={copy} memory="旧记忆" onSave={onSave} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "正在编辑" } });
    rerender(<UserMemoryEditor copy={copy} memory="后台新增记忆" onSave={onSave} />);
    expect(screen.getByRole("textbox")).toHaveValue("正在编辑");
  });

  it("保存期间禁用重复提交，清除直接保存空记忆", async () => {
    let finish!: (saved: boolean) => void;
    const onSave = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    render(<UserMemoryEditor copy={copy} memory="旧记忆" onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: copy.userMemoryClear }));
    expect(onSave).toHaveBeenCalledWith("");
    expect(screen.getByRole("button", { name: copy.userMemorySave })).toBeDisabled();
    await act(async () => { finish(true); });
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("清除失败时保留草稿", async () => {
    render(<UserMemoryEditor copy={copy} memory="旧记忆" onSave={vi.fn(async () => false)} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: copy.userMemoryClear })); });
    expect(screen.getByRole("textbox")).toHaveValue("旧记忆");
  });
});
