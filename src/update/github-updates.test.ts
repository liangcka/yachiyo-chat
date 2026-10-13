/// <reference types="node" />
import { webcrypto } from "node:crypto";
import type { BundleInfo } from "@capgo/capacitor-updater";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import mobileRelease from "../../mobile-release.json";
import {
  NativeUpdateService,
  verifyReleaseManifest,
  type NativeUpdateDependencies,
  type ReleaseManifest,
} from "./github-updates";

const version = "20261015010000";
const currentVersion = "20261014010000";
const manifest: ReleaseManifest = {
  schemaVersion: 1,
  appId: "app.yachiyo.chat",
  platform: "android",
  runtimeVersion: "android-1",
  nativeBuild: 13,
  nativeVersion: "0.1.13",
  version,
  url: `https://github.com/liangcka/yachiyo-chat/releases/download/mobile-v0.1.13/yachiyo-web-${version}.zip`,
  checksum: "a".repeat(512),
  sessionKey: `${btoa("i".repeat(16))}:${btoa("k".repeat(256))}`,
};

let keys: CryptoKeyPair;
let publicKey: string;

async function signedManifest(value: unknown = manifest) {
  const payload = JSON.stringify(value);
  const signature = await webcrypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keys.privateKey,
    new TextEncoder().encode(payload),
  );
  return { payload, signature: Buffer.from(signature).toString("base64") };
}

function bundle(id: string, value: string, status: BundleInfo["status"] = "success"): BundleInfo {
  return { id, version: value, status, checksum: "a".repeat(64), downloaded: value };
}

function dependencies(overrides: Partial<NativeUpdateDependencies> = {}): NativeUpdateDependencies {
  return {
    supported: true,
    nativeBuild: 13,
    runtimeVersion: "android-1",
    embeddedVersion: currentVersion,
    publicKey,
    readManifest: vi.fn(() => signedManifest()),
    updater: {
      current: vi.fn(async () => ({ bundle: bundle("current", currentVersion), native: "0.1.13" })),
      list: vi.fn(async () => ({ bundles: [] })),
      download: vi.fn(async () => bundle("new", version, "pending")),
      set: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
      addDownloadListener: vi.fn(async () => ({ remove: vi.fn(async () => undefined) })),
    },
    ...overrides,
  };
}

beforeAll(async () => {
  keys = await webcrypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  ) as CryptoKeyPair;
  const der = await webcrypto.subtle.exportKey("spki", keys.publicKey);
  publicKey = `-----BEGIN PUBLIC KEY-----\n${Buffer.from(der).toString("base64")}\n-----END PUBLIC KEY-----`;
});

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
});

describe("GitHub 更新清单验签", () => {
  it("验证原始 payload 签名再解析资源信息", async () => {
    await expect(verifyReleaseManifest(await signedManifest(), publicKey)).resolves.toEqual(manifest);
  });

  it("拒绝内容篡改、错误签名与未签名清单", async () => {
    const envelope = await signedManifest();
    await expect(verifyReleaseManifest({ ...envelope, payload: envelope.payload.replace(version, currentVersion) }, publicKey)).rejects.toThrow();
    await expect(verifyReleaseManifest({ ...envelope, signature: btoa("x".repeat(256)) }, publicKey)).rejects.toThrow();
    await expect(verifyReleaseManifest(manifest, publicKey)).rejects.toThrow();
  });

  it.each([
    { url: `https://evil.example/yachiyo-web-${version}.zip` },
    { url: `https://github.com/other/repo/releases/download/tag/yachiyo-web-${version}.zip` },
    { url: `${manifest.url}?redirect=evil` },
    { url: manifest.url.replace(version, currentVersion) },
    { appId: "other.app" },
    { platform: "ios" },
    { schemaVersion: 2 },
    { version: "1.0.0" },
    { nativeBuild: 13.5 },
    { nativeVersion: "0.1" },
    { nativeVersion: "../other" },
    { nativeVersion: "0.01.13" },
    { nativeVersion: `${"1".repeat(30)}.1.1` },
    { checksum: "abc" },
    { sessionKey: "invalid" },
  ])("拒绝不符合边界契约的签名清单 %j", async (patch) => {
    await expect(verifyReleaseManifest(await signedManifest({ ...manifest, ...patch }), publicKey)).rejects.toThrow();
  });

  it("接受官方 CLI 产生的 base64 RSA 校验和", async () => {
    const value = { ...manifest, checksum: btoa("s".repeat(256)) };
    await expect(verifyReleaseManifest(await signedManifest(value), publicKey)).resolves.toEqual(value);
  });
});

describe("Android 手动热更新", () => {
  it("Web 不调用原生或网络接口", async () => {
    const deps = dependencies({ supported: false });
    const service = new NativeUpdateService(deps);
    await service.check();
    await service.apply(() => false);
    expect(deps.readManifest).not.toHaveBeenCalled();
    expect(deps.updater.current).not.toHaveBeenCalled();
  });

  it("并发检查只下载一次，待用户操作才启用", async () => {
    const deps = dependencies();
    const service = new NativeUpdateService(deps);
    await Promise.all([service.check(), service.check()]);
    expect(deps.readManifest).toHaveBeenCalledTimes(1);
    expect(deps.updater.download).toHaveBeenCalledWith({ url: manifest.url, version, checksum: manifest.checksum, sessionKey: manifest.sessionKey });
    expect(service.getSnapshot()).toMatchObject({ status: "ready", availableVersion: version, progress: 100 });
    expect(deps.updater.set).not.toHaveBeenCalled();
    await service.apply(() => false);
    expect(deps.updater.set).toHaveBeenCalledWith({ id: "new" });
  });

  it.each([
    { patch: { nativeBuild: 14 }, status: "incompatible" },
    { patch: { runtimeVersion: "android-2" }, status: "error" },
  ])("不下载不兼容原生版本 %j", async ({ patch, status }) => {
    const deps = dependencies({ readManifest: async () => signedManifest({ ...manifest, ...patch }) });
    const service = new NativeUpdateService(deps);
    await service.check();
    expect(service.getSnapshot().status).toBe(status);
    expect(deps.updater.download).not.toHaveBeenCalled();
  });

  it("不兼容时链接到验签清单指定的新 APK，而非 OTA 最新发布页", async () => {
    const deps = dependencies({ readManifest: async () => signedManifest({ ...manifest, nativeBuild: 14, nativeVersion: "0.1.14" }) });
    const service = new NativeUpdateService(deps);
    await service.check();
    expect(service.getSnapshot()).toMatchObject({
      status: "incompatible",
      apkReleaseUrl: "https://github.com/liangcka/yachiyo-chat/releases/tag/v0.1.14",
    });
    expect(deps.updater.download).not.toHaveBeenCalled();
  });

  it("较旧原生基线的发布清单不引导新 APK 降级", async () => {
    const deps = dependencies({ readManifest: async () => signedManifest({ ...manifest, nativeBuild: 12, nativeVersion: "0.1.12" }) });
    const service = new NativeUpdateService(deps);
    await service.check();
    expect(service.getSnapshot()).toMatchObject({
      status: "current", availableVersion: null,
      apkReleaseUrl: `https://github.com/liangcka/yachiyo-chat/releases/tag/v${mobileRelease.nativeVersion}`,
    });
    expect(deps.updater.download).not.toHaveBeenCalled();
  });

  it.each([currentVersion, "20261013010000"])("不下载相同或旧版本 %s", async (oldVersion) => {
    const deps = dependencies({ readManifest: async () => signedManifest({ ...manifest, version: oldVersion, url: manifest.url.replace(version, oldVersion) }) });
    const service = new NativeUpdateService(deps);
    await service.check();
    expect(service.getSnapshot().status).toBe("current");
    expect(deps.updater.download).not.toHaveBeenCalled();
  });

  it("已运行的 OTA 比 APK 内置版本更新时禁止回退", async () => {
    const deps = dependencies();
    vi.mocked(deps.updater.current).mockResolvedValue({ bundle: bundle("future", "20261016010000"), native: "0.1.13" });
    const service = new NativeUpdateService(deps);
    await service.check();
    expect(service.getSnapshot()).toMatchObject({ status: "current", currentVersion: "20261016010000" });
    expect(deps.updater.download).not.toHaveBeenCalled();
  });

  it("重用已完成的待启用包并保留当前和上一成功包", async () => {
    const deps = dependencies();
    vi.mocked(deps.updater.list).mockResolvedValue({ bundles: [
      bundle("current", currentVersion), bundle("previous", "20261013010000"),
      bundle("old", "20261012010000"), bundle("new", version, "pending"),
      bundle("broken", "20261011010000", "error"),
    ] });
    const service = new NativeUpdateService(deps);
    await service.check();
    expect(service.getSnapshot().status).toBe("ready");
    expect(deps.updater.download).not.toHaveBeenCalled();
    expect(deps.updater.delete).toHaveBeenCalledWith({ id: "old" });
    expect(deps.updater.delete).toHaveBeenCalledWith({ id: "broken" });
    expect(deps.updater.delete).not.toHaveBeenCalledWith({ id: "current" });
    expect(deps.updater.delete).not.toHaveBeenCalledWith({ id: "previous" });
    expect(deps.updater.delete).not.toHaveBeenCalledWith({ id: "new" });
  });

  it("下载失败保留旧包且允许重试", async () => {
    const deps = dependencies();
    let stored: BundleInfo[] = [];
    vi.mocked(deps.updater.list).mockImplementation(async () => ({ bundles: stored }));
    vi.mocked(deps.updater.download).mockImplementationOnce(async () => {
      stored = [{ ...bundle("download-failed", version, "error"), checksum: "" }];
      throw new Error("offline");
    }).mockImplementationOnce(async () => {
      stored = [bundle("new", version, "pending")];
      return stored[0];
    });
    const service = new NativeUpdateService(deps);
    await service.check();
    expect(service.getSnapshot().status).toBe("error");
    expect(deps.updater.set).not.toHaveBeenCalled();
    expect(deps.updater.delete).not.toHaveBeenCalled();
    await service.check();
    expect(service.getSnapshot().status).toBe("ready");
    expect(deps.updater.download).toHaveBeenCalledTimes(2);
  });

  it("重启后可重试保留在原生列表中的下载失败包", async () => {
    const deps = dependencies();
    vi.mocked(deps.updater.list).mockResolvedValue({ bundles: [{ ...bundle("incomplete", version, "error"), checksum: "" }] });
    const service = new NativeUpdateService(deps);
    await service.check();
    expect(service.getSnapshot().status).toBe("ready");
    expect(deps.updater.download).toHaveBeenCalledTimes(1);
  });

  it("原生已回滚的失败版本不重复下载，等待更高版本", async () => {
    const deps = dependencies();
    vi.mocked(deps.updater.list).mockResolvedValue({ bundles: [bundle("failed", version, "error")] });
    const service = new NativeUpdateService(deps);
    await service.check();
    await service.check();
    const restarted = new NativeUpdateService(deps);
    await restarted.check();
    expect(service.getSnapshot().status).toBe("error");
    expect(restarted.getSnapshot().status).toBe("error");
    expect(deps.updater.download).not.toHaveBeenCalled();
    expect(deps.updater.set).not.toHaveBeenCalled();
    const newer = "20261016010000";
    vi.mocked(deps.readManifest).mockImplementation(async () => signedManifest({ ...manifest, version: newer, url: manifest.url.replace(version, newer) }));
    vi.mocked(deps.updater.download).mockResolvedValue(bundle("newer", newer, "pending"));
    await service.check();
    expect(service.getSnapshot().status).toBe("ready");
    expect(deps.updater.delete).toHaveBeenCalledWith({ id: "failed" });
  });

  it("启动检查在多次挂载下只执行一次", async () => {
    const deps = dependencies();
    const service = new NativeUpdateService(deps);
    service.checkOnLaunch();
    service.checkOnLaunch();
    await service.check();
    expect(deps.readManifest).toHaveBeenCalledTimes(1);
  });

  it("聊天繁忙或有草稿时不启用，稍后仍可启用", async () => {
    const deps = dependencies();
    const service = new NativeUpdateService(deps);
    await service.check();
    service.dismiss();
    expect(service.getSnapshot()).toMatchObject({ status: "ready", dismissed: true });
    await service.apply(() => true);
    expect(deps.updater.set).not.toHaveBeenCalled();
    await service.apply(() => false);
    expect(deps.updater.set).toHaveBeenCalledTimes(1);
  });

  it("启用前异步检查期间开始聊天也必须阻止切换", async () => {
    const deps = dependencies();
    const service = new NativeUpdateService(deps);
    await service.check();
    let busy = false;
    vi.mocked(deps.updater.current).mockImplementation(async () => {
      busy = true;
      return { bundle: bundle("current", currentVersion), native: "0.1.13" };
    });
    await service.apply(() => busy);
    expect(deps.updater.set).not.toHaveBeenCalled();
  });

  it("等待持久化准备完成才启用资源包", async () => {
    const deps = dependencies();
    const service = new NativeUpdateService(deps);
    await service.check();
    let finish = (): void => undefined;
    const pendingSave = new Promise<void>((resolve) => { finish = resolve; });
    const prepare = vi.fn(() => pendingSave);
    const applying = service.apply(() => false, prepare);
    await vi.waitFor(() => { expect(prepare).toHaveBeenCalledTimes(1); });
    expect(deps.updater.set).not.toHaveBeenCalled();
    finish();
    await applying;
    expect(deps.updater.set).toHaveBeenCalledWith({ id: "new" });
  });

  it("持久化准备失败时不启用资源包", async () => {
    const deps = dependencies();
    const service = new NativeUpdateService(deps);
    await service.check();
    await service.apply(() => false, async () => { throw new Error("storage full"); });
    expect(deps.updater.set).not.toHaveBeenCalled();
    expect(service.getSnapshot().status).toBe("error");
  });

  it("持久化准备期间开始输入或回复时阻止启用", async () => {
    const deps = dependencies();
    const service = new NativeUpdateService(deps);
    await service.check();
    let busy = false;
    await service.apply(() => busy, async () => { busy = true; });
    expect(deps.updater.set).not.toHaveBeenCalled();
    expect(service.getSnapshot().status).toBe("ready");
  });

  it("清理异步注册的下载监听，卸载后不通知订阅者", async () => {
    const deps = dependencies();
    const remove = vi.fn(async () => undefined);
    vi.mocked(deps.updater.addDownloadListener).mockImplementation(async () => ({ remove }));
    const service = new NativeUpdateService(deps);
    const callback = vi.fn();
    const unsubscribe = service.subscribe(callback);
    unsubscribe();
    await Promise.resolve();
    await Promise.resolve();
    expect(remove).toHaveBeenCalledTimes(1);
    await service.check();
    expect(callback).not.toHaveBeenCalled();
  });
});
