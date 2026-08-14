import { beforeEach, describe, expect, it } from "vitest";
import { getDeviceId, type DeviceIdStorage } from "./device-id";

function memoryStorage(): DeviceIdStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe("getDeviceId", () => {
  let storage: DeviceIdStorage;

  beforeEach(() => {
    storage = memoryStorage();
  });

  it("creates and persists a stable id on first use", () => {
    const first = getDeviceId(storage);
    const second = getDeviceId(storage);

    expect(first.length).toBeGreaterThan(0);
    expect(second).toBe(first);
  });

  it("returns an existing stored id without generating a new one", () => {
    storage.setItem("yachiyo-device-id", "existing-device-42");

    expect(getDeviceId(storage)).toBe("existing-device-42");
  });

  it("discards a malformed stored value and regenerates", () => {
    storage.setItem("yachiyo-device-id", "");

    expect(getDeviceId(storage)).toMatch(/^[A-Za-z0-9-]+$/u);
  });
});
