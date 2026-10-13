import { Capacitor, CapacitorHttp, type PluginListenerHandle } from "@capacitor/core";
import {
  CapacitorUpdater,
  type BundleInfo,
  type BundleListResult,
  type CurrentBundleResult,
  type DownloadEvent,
  type DownloadOptions,
} from "@capgo/capacitor-updater";
import mobileRelease from "../../mobile-release.json";
import publicKey from "./public-key.txt?raw";

export const GITHUB_UPDATE_URL =
  "https://github.com/liangcka/yachiyo-chat/releases/latest/download/app-update.json";
export const GITHUB_APK_RELEASE_URL =
  `https://github.com/liangcka/yachiyo-chat/releases/tag/v${mobileRelease.nativeVersion}`;

export type PrepareForNativeReload = () => Promise<void>;

export interface ReleaseManifest {
  schemaVersion: 1;
  appId: "app.yachiyo.chat";
  platform: "android";
  runtimeVersion: string;
  nativeBuild: number;
  nativeVersion: string;
  version: string;
  url: string;
  checksum: string;
  sessionKey: string;
}

export type NativeUpdateStatus = "idle" | "checking" | "current" | "downloading" | "ready" | "error" | "incompatible";

export interface NativeUpdateSnapshot {
  supported: boolean;
  currentVersion: string;
  availableVersion: string | null;
  status: NativeUpdateStatus;
  progress: number;
  dismissed: boolean;
  apkReleaseUrl: string;
}

interface NativeUpdater {
  current(): Promise<CurrentBundleResult>;
  list(): Promise<BundleListResult>;
  download(options: DownloadOptions): Promise<BundleInfo>;
  set(options: { id: string }): Promise<void>;
  delete(options: { id: string }): Promise<void>;
  addDownloadListener(listener: (event: DownloadEvent) => void): Promise<PluginListenerHandle>;
}

export interface NativeUpdateDependencies {
  supported: boolean;
  nativeBuild: number;
  runtimeVersion: string;
  embeddedVersion: string;
  publicKey: string;
  readManifest(): Promise<unknown>;
  updater: NativeUpdater;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("更新签名编码无效。");
  }
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function validVersion(value: unknown): value is string {
  return typeof value === "string" && /^\d{14}$/.test(value);
}

function validNativeVersion(value: unknown): value is string {
  return typeof value === "string" && value.length <= 32 && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value);
}

function validBundleUrl(value: unknown, version: string): value is string {
  if (typeof value !== "string") return false;
  const prefix = "https://github.com/liangcka/yachiyo-chat/releases/download/";
  if (!value.startsWith(prefix)) return false;
  const suffix = value.slice(prefix.length);
  return new RegExp(`^[A-Za-z0-9._-]+/yachiyo-web-${version}\\.zip$`).test(suffix);
}

function validEncryptedChecksum(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (/^[a-fA-F0-9]{512}$/.test(value)) return true;
  return value.length === 344 && decodeBase64(value).byteLength === 256;
}

function validSessionKey(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 400) return false;
  const parts = value.split(":");
  return parts.length === 2 && decodeBase64(parts[0]).byteLength === 16 && decodeBase64(parts[1]).byteLength === 256;
}

/** 必须对原始字符串验签，重新序列化可能改变已签名的字节。 */
export async function verifyReleaseManifest(envelope: unknown, pem: string): Promise<ReleaseManifest> {
  if (!isRecord(envelope) || typeof envelope.payload !== "string" || envelope.payload.length > 16_384 ||
    typeof envelope.signature !== "string" || envelope.signature.length !== 344) {
    throw new Error("更新清单格式无效。");
  }
  const signature = decodeBase64(envelope.signature);
  if (signature.byteLength !== 256) throw new Error("更新签名长度无效。");
  const encodedKey = pem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, "");
  const key = await crypto.subtle.importKey(
    "spki",
    decodeBase64(encodedKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  if (!await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, new TextEncoder().encode(envelope.payload))) {
    throw new Error("更新清单签名无效。");
  }
  const value: unknown = JSON.parse(envelope.payload);
  if (!isRecord(value) || value.schemaVersion !== 1 || value.appId !== "app.yachiyo.chat" || value.platform !== "android" ||
    typeof value.runtimeVersion !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(value.runtimeVersion) ||
    !Number.isSafeInteger(value.nativeBuild) || typeof value.nativeBuild !== "number" || value.nativeBuild < 1 || !validNativeVersion(value.nativeVersion) ||
    !validVersion(value.version) || !validBundleUrl(value.url, value.version) ||
    !validEncryptedChecksum(value.checksum) || !validSessionKey(value.sessionKey)) {
    throw new Error("更新清单内容无效。");
  }
  return {
    schemaVersion: 1,
    appId: "app.yachiyo.chat",
    platform: "android",
    runtimeVersion: value.runtimeVersion,
    nativeBuild: value.nativeBuild,
    nativeVersion: value.nativeVersion,
    version: value.version,
    url: value.url,
    checksum: value.checksum,
    sessionKey: value.sessionKey,
  };
}

async function readGitHubManifest(): Promise<unknown> {
  const response = await CapacitorHttp.get({
    url: GITHUB_UPDATE_URL,
    responseType: "json",
    connectTimeout: 15_000,
    readTimeout: 15_000,
    headers: { Accept: "application/json", "Cache-Control": "no-cache" },
  });
  if (response.status !== 200) throw new Error("暂时无法读取更新清单。");
  const data: unknown = response.data;
  return typeof data === "string" ? JSON.parse(data) as unknown : data;
}

export class NativeUpdateService {
  private snapshot: NativeUpdateSnapshot;
  private readonly listeners = new Set<() => void>();
  private downloadListener: PluginListenerHandle | null = null;
  private listenerGeneration = 0;
  private checkPromise: Promise<void> | null = null;
  private applying = false;
  private started = false;
  private pendingBundle: BundleInfo | null = null;

  constructor(private readonly dependencies: NativeUpdateDependencies) {
    this.snapshot = {
      supported: dependencies.supported,
      currentVersion: dependencies.embeddedVersion,
      availableVersion: null,
      status: "idle",
      progress: 0,
      dismissed: false,
      apkReleaseUrl: GITHUB_APK_RELEASE_URL,
    };
  }

  getSnapshot = (): NativeUpdateSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.dependencies.supported && this.listeners.size === 1) this.attachDownloadListener();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.listenerGeneration += 1;
        void this.downloadListener?.remove().catch(() => undefined);
        this.downloadListener = null;
      }
    };
  };

  checkOnLaunch = (): void => {
    if (this.started) return;
    this.started = true;
    void this.check();
  };

  check = (): Promise<void> => {
    if (!this.dependencies.supported || this.applying) return Promise.resolve();
    if (this.checkPromise) return this.checkPromise;
    this.checkPromise = this.performCheck().finally(() => { this.checkPromise = null; });
    return this.checkPromise;
  };

  dismiss = (): void => {
    this.update({ dismissed: true });
  };

  apply = async (blocked: () => boolean, prepareForReload?: PrepareForNativeReload): Promise<void> => {
    if (!this.dependencies.supported || this.applying || this.snapshot.status !== "ready" || !this.pendingBundle || blocked()) return;
    this.applying = true;
    try {
      const current = await this.dependencies.updater.current();
      if (validVersion(current.bundle.version) && current.bundle.version >= this.pendingBundle.version) {
        this.update({ status: "current", currentVersion: current.bundle.version, availableVersion: null });
        return;
      }
      // 原生查询期间可能开始回复或输入草稿，切换前再次读取最新状态。
      if (blocked()) return;
      await prepareForReload?.();
      if (blocked()) return;
      await this.dependencies.updater.set({ id: this.pendingBundle.id });
    } catch {
      this.update({ status: "error", dismissed: false });
    } finally {
      this.applying = false;
    }
  };

  private update(patch: Partial<NativeUpdateSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  private attachDownloadListener(): void {
    const generation = ++this.listenerGeneration;
    void this.dependencies.updater.addDownloadListener((event) => {
      if (this.snapshot.status === "downloading" && event.bundle.version === this.snapshot.availableVersion && Number.isFinite(event.percent)) {
        this.update({ progress: Math.max(0, Math.min(100, event.percent)) });
      }
    }).then((handle) => {
      if (generation !== this.listenerGeneration || this.listeners.size === 0) {
        void handle.remove().catch(() => undefined);
      } else {
        this.downloadListener = handle;
      }
    }).catch(() => undefined);
  }

  private async performCheck(): Promise<void> {
    this.update({ status: "checking", progress: 0, dismissed: false });
    try {
      const current = await this.dependencies.updater.current();
      const currentVersion = validVersion(current.bundle.version) && current.bundle.version > this.dependencies.embeddedVersion
        ? current.bundle.version : this.dependencies.embeddedVersion;
      this.update({ currentVersion });
      const manifest = await verifyReleaseManifest(await this.dependencies.readManifest(), this.dependencies.publicKey);
      if (manifest.nativeBuild < this.dependencies.nativeBuild) {
        this.pendingBundle = null;
        this.update({ status: "current", availableVersion: null, apkReleaseUrl: GITHUB_APK_RELEASE_URL });
        return;
      }
      this.update({ apkReleaseUrl: `https://github.com/liangcka/yachiyo-chat/releases/tag/v${manifest.nativeVersion}` });
      if (manifest.nativeBuild > this.dependencies.nativeBuild) {
        this.pendingBundle = null;
        this.update({ status: "incompatible", availableVersion: manifest.version });
        return;
      }
      if (manifest.runtimeVersion !== this.dependencies.runtimeVersion) {
        this.pendingBundle = null;
        this.update({ status: "error", availableVersion: null });
        return;
      }
      if (manifest.version <= currentVersion) {
        this.pendingBundle = null;
        this.update({ status: "current", availableVersion: null });
        return;
      }
      this.update({ status: "downloading", availableVersion: manifest.version });
      const { bundles } = await this.dependencies.updater.list();
      // 手动下载失败的原生记录校验和为空；已验证包加载回滚会保留校验和。
      // 原生 download() 会先删除下载失败记录，允许网络或空间恢复后重试。
      if (bundles.some((item) => item.version === manifest.version && item.status === "error" && item.checksum.length > 0)) {
        this.pendingBundle = null;
        this.update({ status: "error" });
        return;
      }
      const reusable = bundles.find((item) => item.version === manifest.version && item.status === "pending");
      const pending = reusable ?? await this.dependencies.updater.download({
        url: manifest.url,
        version: manifest.version,
        checksum: manifest.checksum,
        sessionKey: manifest.sessionKey,
      });
      if (!pending.id || pending.id === "builtin" || pending.version !== manifest.version || (pending.status !== "pending" && pending.status !== "success")) {
        throw new Error("下载的更新资源不可用。");
      }
      this.pendingBundle = pending;
      await this.pruneBundles(current.bundle.id, pending.id);
      this.update({ status: "ready", progress: 100, dismissed: false });
    } catch {
      this.update({ status: "error", dismissed: false });
    }
  }

  private async pruneBundles(currentId: string, pendingId: string): Promise<void> {
    try {
      const { bundles } = await this.dependencies.updater.list();
      const previous = bundles.filter((item) => item.status === "success" && item.id !== currentId)
        .sort((left, right) => right.downloaded.localeCompare(left.downloaded))[0];
      const keep = new Set(["builtin", currentId, pendingId, previous?.id]);
      for (const item of bundles) {
        if (!keep.has(item.id)) await this.dependencies.updater.delete({ id: item.id }).catch(() => undefined);
      }
    } catch {
      // 清理失败不影响已经验证可用的包，下次下载完成后重试。
    }
  }
}

const embeddedVersion = import.meta.env.VITE_BUNDLE_VERSION || mobileRelease.bundleVersion;

export const nativeUpdateService = new NativeUpdateService({
  supported: Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android",
  nativeBuild: mobileRelease.nativeBuild,
  runtimeVersion: mobileRelease.runtimeVersion,
  embeddedVersion: validVersion(embeddedVersion) ? embeddedVersion : mobileRelease.bundleVersion,
  publicKey,
  readManifest: readGitHubManifest,
  updater: {
    current: () => CapacitorUpdater.current(),
    list: () => CapacitorUpdater.list(),
    download: (options) => CapacitorUpdater.download(options),
    set: (options) => CapacitorUpdater.set(options),
    delete: (options) => CapacitorUpdater.delete(options),
    addDownloadListener: (listener) => CapacitorUpdater.addListener("download", listener),
  },
});
