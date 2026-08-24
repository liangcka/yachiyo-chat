import { Capacitor } from "@capacitor/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiCredentials, apiOrigin, isNativeApp } from "./app-platform";

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: vi.fn(() => false) },
}));

describe("app-platform", () => {
  beforeEach(() => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
  });

  it("keeps same-origin relative requests in the browser build", () => {
    expect(isNativeApp()).toBe(false);
    expect(apiOrigin()).toBe("");
    expect(apiCredentials()).toBe("same-origin");
  });

  it("targets the deployed origin with credentials from the native shell", () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);

    expect(isNativeApp()).toBe(true);
    expect(apiOrigin()).toBe("https://yachiyochat.amtale.cn");
    expect(apiCredentials()).toBe("include");
  });
});
