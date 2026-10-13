import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RegisterSWOptions } from "vite-plugin-pwa/types";
import { usePwaUpdate } from "./use-pwa-update";

const mocks = vi.hoisted(() => ({
  native: false,
  register: vi.fn(),
  update: vi.fn(async () => undefined),
}));
vi.mock("virtual:pwa-register", () => ({ registerSW: mocks.register }));
vi.mock("../services/app-platform", () => ({ isNativeApp: () => mocks.native }));

describe("PWA 与原生资源更新隔离", () => {
  afterEach(() => {
    mocks.native = false;
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("Android 不注册 Service Worker", async () => {
    mocks.native = true;
    const { result, unmount } = renderHook(() => usePwaUpdate());
    await result.current.updateServiceWorker(true);
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    unmount();
  });

  it("网页保留显式更新，并在卸载后清理检查事件与定时器", async () => {
    mocks.register.mockReturnValue(mocks.update);
    const removeWindow = vi.spyOn(window, "removeEventListener");
    const removeDocument = vi.spyOn(document, "removeEventListener");
    const clearInterval = vi.spyOn(window, "clearInterval");
    const registration = { update: vi.fn(async () => undefined) } as unknown as ServiceWorkerRegistration;
    const { result, unmount } = renderHook(() => usePwaUpdate());
    const options = mocks.register.mock.calls[0][0] as RegisterSWOptions;
    act(() => {
      options.onRegisteredSW?.("/sw.js", registration);
      options.onNeedRefresh?.();
      options.onOfflineReady?.();
    });
    expect(result.current.needRefresh).toBe(true);
    expect(result.current.offlineReady).toBe(true);
    expect(mocks.update).not.toHaveBeenCalled();
    await result.current.updateServiceWorker(true);
    expect(mocks.update).toHaveBeenCalledWith(true);
    unmount();
    const checks = vi.mocked(registration.update).mock.calls.length;
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(registration.update).toHaveBeenCalledTimes(checks);
    expect(clearInterval).toHaveBeenCalledOnce();
    expect(removeWindow).toHaveBeenCalledWith("focus", expect.any(Function));
    expect(removeDocument).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  });
});
