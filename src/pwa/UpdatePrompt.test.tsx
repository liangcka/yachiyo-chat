import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyFor } from "../i18n/messages";
import { UpdatePrompt } from "./UpdatePrompt";

const serviceWorker = vi.hoisted(() => ({
  offlineReady: false,
  needRefresh: false,
  setOfflineReady: vi.fn(),
  setNeedRefresh: vi.fn(),
  update: vi.fn(async () => undefined),
}));

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: () => ({
    needRefresh: [serviceWorker.needRefresh, serviceWorker.setNeedRefresh],
    offlineReady: [serviceWorker.offlineReady, serviceWorker.setOfflineReady],
    updateServiceWorker: serviceWorker.update,
  }),
}));

describe("UpdatePrompt", () => {
  afterEach(() => {
    serviceWorker.offlineReady = false;
    serviceWorker.needRefresh = false;
    vi.clearAllMocks();
  });

  it("announces that offline use is ready", () => {
    serviceWorker.offlineReady = true;
    render(<UpdatePrompt copy={copyFor("zh-CN")} />);

    expect(screen.getByRole("status")).toHaveTextContent("应用已可离线打开。");
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    expect(serviceWorker.setOfflineReady).toHaveBeenCalledWith(false);
  });

  it("updates only after explicit confirmation", () => {
    serviceWorker.needRefresh = true;
    render(<UpdatePrompt copy={copyFor("ja-JP")} />);

    expect(screen.getByText("新しいバージョンを利用できます。")).toBeVisible();
    expect(serviceWorker.update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "今すぐ更新" }));
    expect(serviceWorker.update).toHaveBeenCalledWith(true);
  });

  it("dismisses update prompt when cancel button is clicked", () => {
    serviceWorker.needRefresh = true;
    render(<UpdatePrompt copy={copyFor("zh-CN")} />);

    expect(screen.getByText("新版本已经准备好了。")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(serviceWorker.setNeedRefresh).toHaveBeenCalledWith(false);
  });
});
