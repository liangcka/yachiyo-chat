const STORAGE_KEY = "yachiyo-device-id";

export interface DeviceIdStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const browserStorage: DeviceIdStorage = {
  getItem: (key) => (typeof localStorage === "undefined" ? null : localStorage.getItem(key)),
  setItem: (key, value) => {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
  },
};

/**
 * 读取或生成本设备的持久化标识。
 *
 * 用途:服务端按设备而非会话计数每日额度,避免"重新输入访问码即重置额度"的绕过。
 * 仅存本机 localStorage,不随请求体以外的地方透传,服务端写入签名 session payload。
 */
export function getDeviceId(storage: DeviceIdStorage = browserStorage): string {
  const existing = storage.getItem(STORAGE_KEY);
  if (existing !== null && existing.length > 0 && existing.length <= 128) {
    return existing;
  }
  const created = crypto.randomUUID();
  storage.setItem(STORAGE_KEY, created);
  return created;
}
