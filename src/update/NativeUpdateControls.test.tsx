import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { copyFor } from "../i18n/messages";
import { NativeUpdatePrompt, NativeUpdateSettings } from "./NativeUpdateControls";
import type { NativeUpdateState } from "./use-native-update";

function updateState(overrides: Partial<NativeUpdateState> = {}): NativeUpdateState {
  return {
    supported: true,
    currentVersion: "0.1.13",
    apkReleaseUrl: "https://github.com/liangcka/yachiyo-chat/releases/tag/v0.1.14",
    availableVersion: null,
    status: "idle",
    progress: 0,
    dismissed: false,
    check: vi.fn(async () => undefined),
    apply: vi.fn(async () => undefined),
    dismiss: vi.fn(),
    ...overrides,
  };
}

describe("原生更新控件", () => {
  it("Web 不显示原生检查入口与提示", () => {
    const update = updateState({ supported: false, status: "ready", availableVersion: "0.1.14" });
    const { container } = render(<>
      <NativeUpdatePrompt blocked={false} copy={copyFor("zh-CN")} update={update} />
      <NativeUpdateSettings copy={copyFor("zh-CN")} update={update} />
    </>);
    expect(container).toBeEmptyDOMElement();
  });

  it("明确点击后才启用已下载的更新，也可以稍后再处理", () => {
    const update = updateState({ status: "ready", availableVersion: "0.1.14" });
    render(<NativeUpdatePrompt blocked={false} copy={copyFor("zh-CN")} update={update} />);
    expect(screen.getByRole("status")).toHaveTextContent("新版本 0.1.14 已准备好");
    expect(update.apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "立即更新" }));
    expect(update.apply).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "稍后" }));
    expect(update.dismiss).toHaveBeenCalledOnce();
  });

  it("聊天、草稿或面板未处理时禁止启用并给出原因", () => {
    const update = updateState({ status: "ready", availableVersion: "0.1.14" });
    render(<NativeUpdatePrompt blocked copy={copyFor("zh-CN")} update={update} />);
    const apply = screen.getByRole("button", { name: "立即更新" });
    expect(apply).toBeDisabled();
    expect(apply).toHaveAccessibleDescription(/处理草稿或图片，并关闭面板/);
    fireEvent.click(apply);
    expect(update.apply).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "稍后" })).toBeEnabled();
  });

  it("下载时提供可访问进度，完成前没有启用按钮", () => {
    const update = updateState({ status: "downloading", progress: 42.2 });
    const { rerender } = render(
      <NativeUpdatePrompt blocked={false} copy={copyFor("ja-JP")} update={update} />,
    );
    expect(screen.getByRole("progressbar", { name: "アプリの更新" })).toHaveAttribute("value", "42");
    expect(screen.getByRole("status")).toHaveTextContent("更新をダウンロード中 42%");
    expect(screen.queryByRole("button", { name: "今すぐ更新" })).not.toBeInTheDocument();
    rerender(<NativeUpdatePrompt blocked={false} copy={copyFor("ja-JP")} update={{ ...update, progress: 120 }} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "100");
  });

  it("收起提示仍可从设置检查更新并查看当前版本", () => {
    const update = updateState({ status: "current", dismissed: true });
    render(<>
      <NativeUpdatePrompt blocked={false} copy={copyFor("zh-CN")} update={update} />
      <NativeUpdateSettings copy={copyFor("zh-CN")} update={update} />
    </>);
    expect(screen.getByRole("region", { name: "应用更新" })).toBeVisible();
    expect(screen.getByText("当前版本 0.1.13")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("已是最新版本");
    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));
    expect(update.check).toHaveBeenCalledOnce();
  });

  it("检查与下载期间禁用重复检查，错误后允许重试", () => {
    const update = updateState({ status: "checking" });
    const { rerender } = render(<NativeUpdateSettings copy={copyFor("zh-CN")} update={update} />);
    expect(screen.getByRole("button", { name: "检查更新" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("正在检查更新…");
    rerender(<NativeUpdateSettings copy={copyFor("zh-CN")} update={{ ...update, status: "downloading", progress: 70 }} />);
    expect(screen.getByRole("button", { name: "检查更新" })).toBeDisabled();
    rerender(<NativeUpdateSettings copy={copyFor("zh-CN")} update={{ ...update, status: "error" }} />);
    expect(screen.getByRole("status")).toHaveTextContent("暂时无法更新");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(update.check).toHaveBeenCalledOnce();
  });

  it("需要新原生版本时指向 GitHub Release 安装 APK", () => {
    render(<NativeUpdateSettings copy={copyFor("zh-CN")} update={updateState({ status: "incompatible" })} />);
    expect(screen.getByRole("status")).toHaveTextContent("直接覆盖安装");
    expect(screen.getByRole("link", { name: "下载新版 APK" })).toHaveAttribute(
      "href", "https://github.com/liangcka/yachiyo-chat/releases/tag/v0.1.14",
    );
  });

  it("已准备好的更新在设置中指引用户返回聊天页确认", () => {
    render(<NativeUpdateSettings copy={copyFor("ja-JP")} update={updateState({ status: "ready", availableVersion: "0.1.14" })} />);
    expect(screen.getByRole("status")).toHaveTextContent("0.1.14");
    expect(screen.getByText("設定を閉じると、チャット画面で更新できます。")).toBeVisible();
    expect(screen.queryByRole("button", { name: "今すぐ更新" })).not.toBeInTheDocument();
  });
});
