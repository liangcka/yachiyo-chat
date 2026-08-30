import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as platform from "../services/app-platform";
import { useDeviceMode } from "./use-device-mode";

describe("useDeviceMode", () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("returns mobile when running in native Capacitor app", () => {
    vi.spyOn(platform, "isNativeApp").mockReturnValue(true);

    const { result } = renderHook(() => useDeviceMode());
    expect(result.current).toBe("mobile");
  });

  it("responds to window.matchMedia in browser web mode", () => {
    vi.spyOn(platform, "isNativeApp").mockReturnValue(false);

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const { result } = renderHook(() => useDeviceMode());
    expect(result.current).toBe("desktop");
  });

  it("returns mobile when matchMedia does not match desktop query", () => {
    vi.spyOn(platform, "isNativeApp").mockReturnValue(false);

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const { result } = renderHook(() => useDeviceMode());
    expect(result.current).toBe("mobile");
  });
});
