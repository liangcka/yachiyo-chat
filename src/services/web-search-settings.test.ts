import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { YachiyoDatabase } from "../data/db";
import { WebSearchSettingsService } from "./web-search-settings";

describe("WebSearchSettingsService", () => {
  let db: YachiyoDatabase;
  let service: WebSearchSettingsService;

  beforeEach(() => {
    db = new YachiyoDatabase(`yachiyo-web-search-test-${crypto.randomUUID()}`);
    service = new WebSearchSettingsService(db);
  });

  afterEach(async () => {
    db.close();
    await db.delete();
  });

  it("returns defaults when nothing is stored", async () => {
    expect(await service.getWebSearchSettings()).toEqual({
      enabled: false,
      showSources: true,
      smart: false,
    });
  });

  it("persists all toggles and reads them back", async () => {
    await service.setEnabled(true);
    await service.setShowSources(false);
    await service.setSmart(true);

    expect(await service.getWebSearchSettings()).toEqual({
      enabled: true,
      showSources: false,
      smart: true,
    });
  });

  it("persists settings object in bulk via set()", async () => {
    await service.set({
      enabled: true,
      showSources: false,
      smart: true,
    });

    expect(await service.getWebSearchSettings()).toEqual({
      enabled: true,
      showSources: false,
      smart: true,
    });
  });

  it("keeps each toggle independent", async () => {
    await service.setEnabled(true);

    expect(await service.getWebSearchSettings()).toEqual({
      enabled: true,
      showSources: true,
      smart: false,
    });

    await service.setShowSources(false);
    expect(await service.getWebSearchSettings()).toEqual({
      enabled: true,
      showSources: false,
      smart: false,
    });

    await service.setSmart(true);
    expect(await service.getWebSearchSettings()).toEqual({
      enabled: true,
      showSources: false,
      smart: true,
    });
  });

  it("falls back to defaults when stored values are invalid", async () => {
    await db.settings.put({ key: "webSearchEnabled", value: "yes" } as never);
    await db.settings.put({ key: "webSearchShowSources", value: 0 } as never);
    await db.settings.put({ key: "webSearchSmart", value: 1 } as never);

    expect(await service.getWebSearchSettings()).toEqual({
      enabled: false,
      showSources: true,
      smart: false,
    });
  });

  it("clears all toggles back to defaults", async () => {
    await service.setEnabled(true);
    await service.setShowSources(false);
    await service.setSmart(true);
    await service.clear();

    expect(await service.getWebSearchSettings()).toEqual({
      enabled: false,
      showSources: true,
      smart: false,
    });
  });
});
