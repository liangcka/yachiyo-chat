import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useOnlineStatus } from "./use-online-status";

let online = true;

describe("useOnlineStatus", () => {
  afterEach(() => {
    online = true;
  });

  it("tracks browser offline and online events", () => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => online,
    });
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toEqual({ isOnline: true });

    act(() => {
      online = false;
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current).toEqual({ isOnline: false });

    act(() => {
      online = true;
      window.dispatchEvent(new Event("online"));
    });
    expect(result.current).toEqual({ isOnline: true });
  });
});
