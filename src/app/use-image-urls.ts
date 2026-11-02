import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, StoredImage } from "../domain/chat";

const maximumLoadRetries = 3;
const retryBaseDelayMs = 150;

export interface ImageUrlCache {
  imageUrls: ReadonlyMap<string, string>;
  /** 为刚处理或从存储取回的图片登记 Blob URL；环境不支持时返回 undefined。 */
  register(id: string, blob: Blob): string | undefined;
  /** 释放全部 Blob URL（清除本地数据时调用）。 */
  revokeAll(): void;
}

function canCreateObjectUrl(): boolean {
  return typeof URL.createObjectURL === "function";
}

/**
 * 消息图片的 Blob URL 缓存：按需从 IndexedDB 读取当前窗口引用的图片，
 * 写入刚落库的图片可能稍晚可读，因此对缺失项做有限次退避重试。
 */
export function useImageUrls(
  getImage: (id: string) => Promise<StoredImage | undefined>,
  messages: readonly ChatMessage[],
): ImageUrlCache {
  const cacheRef = useRef<Map<string, string>>(new Map());
  const [imageUrls, setImageUrls] = useState<ReadonlyMap<string, string>>(new Map());

  // 稳定签名：只有 imageId 集合变化时才触发 Blob 加载 effect
  const imageIdsKey = useMemo(
    () => messages.flatMap(({ imageId }) => (imageId === undefined ? [] : [imageId])).sort().join("\n"),
    [messages],
  );

  const publish = useCallback(() => setImageUrls(new Map(cacheRef.current)), []);

  useEffect(() => {
    if (!canCreateObjectUrl() || imageIdsKey.length === 0) return;
    const cache = cacheRef.current;
    const missingIds = imageIdsKey.split("\n").filter((id) => !cache.has(id));
    if (missingIds.length === 0) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const loadImages = async (attempt: number) => {
      const pending = missingIds.filter((id) => !cache.has(id));
      const loaded = await Promise.all(
        pending.map(async (id) => {
          const image = await getImage(id);
          // 已失效的加载不再写缓存，交由新一轮 effect 重新读取，避免卸载后泄漏 Blob URL
          if (image === undefined || cancelled || cache.has(id)) return false;
          cache.set(id, URL.createObjectURL(image.blob));
          return true;
        }),
      );
      if (cancelled) return;
      if (loaded.some(Boolean)) publish();
      if (missingIds.some((id) => !cache.has(id)) && attempt < maximumLoadRetries) {
        retryTimer = setTimeout(() => void loadImages(attempt + 1), retryBaseDelayMs * (attempt + 1));
      }
    };
    void loadImages(0).catch(() => undefined);

    return () => {
      cancelled = true;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
    };
  }, [getImage, imageIdsKey, publish]);

  const revokeAll = useCallback(() => {
    for (const url of cacheRef.current.values()) URL.revokeObjectURL(url);
    cacheRef.current.clear();
    publish();
  }, [publish]);

  useEffect(() => {
    const cache = cacheRef.current;
    return () => {
      for (const url of cache.values()) URL.revokeObjectURL(url);
      cache.clear();
    };
  }, []);

  const register = useCallback((id: string, blob: Blob): string | undefined => {
    if (!canCreateObjectUrl()) return undefined;
    const url = URL.createObjectURL(blob);
    cacheRef.current.set(id, url);
    publish();
    return url;
  }, [publish]);

  return { imageUrls, register, revokeAll };
}
