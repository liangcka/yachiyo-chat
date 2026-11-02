import { useEffect, useEffectEvent } from "react";

function firstImageFile(data: DataTransfer | null): File | undefined {
  const items = data?.items;
  if (!items) return undefined;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item?.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) return file;
  }
  return undefined;
}

/**
 * 页面任意位置粘贴图片即作为待发送附件；输入框内的粘贴交给输入框自身处理。
 * enabled 为 false（未登录或正在生成/压缩/加载）时不拦截系统粘贴行为。
 */
export function useGlobalImagePaste(enabled: boolean, onImageFile: (file: File) => void): void {
  const handleFile = useEffectEvent(onImageFile);

  useEffect(() => {
    if (!enabled) return;
    const handlePaste = (event: ClipboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const file = firstImageFile(event.clipboardData);
      if (file === undefined) return;
      event.preventDefault();
      handleFile(file);
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [enabled]);
}
