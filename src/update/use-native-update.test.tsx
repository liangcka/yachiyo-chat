import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NativeUpdateSnapshot, PrepareForNativeReload } from "./github-updates";

const service = vi.hoisted(() => ({
  snapshot: {
    supported: true, currentVersion: "20261014010000", availableVersion: "20261015010000",
    status: "ready", progress: 100, dismissed: false,
    apkReleaseUrl: "https://github.com/liangcka/yachiyo-chat/releases/tag/v0.1.13",
  },
  subscribe: vi.fn<(listener: () => void) => () => void>(() => vi.fn()),
  checkOnLaunch: vi.fn(),
  check: vi.fn(async () => undefined),
  apply: vi.fn<(blocked: () => boolean, prepare?: PrepareForNativeReload) => Promise<void>>(async () => undefined),
  dismiss: vi.fn(),
}));

vi.mock("./github-updates", () => ({
  nativeUpdateService: { ...service, getSnapshot: () => service.snapshot as NativeUpdateSnapshot },
}));

import { useNativeUpdate } from "./use-native-update";

beforeEach(() => { vi.clearAllMocks(); });

describe("useNativeUpdate", () => {
  it("挂载后启动后台检查，卸载时取消订阅", () => {
    const remove = vi.fn();
    service.subscribe.mockReturnValue(remove);
    const { result, unmount } = renderHook(() => useNativeUpdate({ blocked: false }));
    expect(service.checkOnLaunch).toHaveBeenCalledTimes(1);
    expect(result.current).toMatchObject({ supported: true, status: "ready", progress: 100 });
    unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("启用时读取最新草稿或回复阻塞状态，异步期间也保留即时判断", async () => {
    const { result, rerender } = renderHook(({ blocked }) => useNativeUpdate({ blocked }), { initialProps: { blocked: false } });
    await act(async () => { await result.current.apply(); });
    const blocked = service.apply.mock.calls[0][0];
    expect(blocked()).toBe(false);
    rerender({ blocked: true });
    expect(blocked()).toBe(true);
    rerender({ blocked: false });
    expect(blocked()).toBe(false);
  });

  it("暴露手动检查和稍后操作", async () => {
    const { result } = renderHook(() => useNativeUpdate({ blocked: false }));
    await act(async () => { await result.current.check(); result.current.dismiss(); });
    expect(service.check).toHaveBeenCalledTimes(1);
    expect(service.dismiss).toHaveBeenCalledTimes(1);
  });

  it("启用准备阶段调用最新持久化回调", async () => {
    const previous = vi.fn(async () => undefined);
    const latest = vi.fn(async () => undefined);
    const { result, rerender } = renderHook(({ prepareForReload }) => useNativeUpdate({ blocked: false, prepareForReload }), {
      initialProps: { prepareForReload: previous },
    });
    await act(async () => { await result.current.apply(); });
    const prepare = service.apply.mock.calls[0][1];
    rerender({ prepareForReload: latest });
    await prepare?.();
    expect(previous).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });
});
