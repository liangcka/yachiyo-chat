import { STICKER_CATALOG, type StickerEntry } from "./catalog.gen";

/** 贴图标记：[sticker:id]，id 仅允许小写字母数字与连字符（与 sync 脚本校验一致） */
const STICKER_TOKEN = /\[sticker:([a-z0-9-]+)\]/gu;

/** 流式期间可能残留在文本尾部的未闭合标记前缀 */
const PARTIAL_STICKER_TOKEN = /\[sticker:[a-z0-9-]*$/u;

export type StickerPiece =
  | { kind: "text"; text: string }
  | { kind: "sticker"; sticker: StickerEntry };

const catalogById = new Map<string, StickerEntry>(STICKER_CATALOG.map((entry) => [entry.id, entry]));

export function getSticker(id: string): StickerEntry | undefined {
  return catalogById.get(id);
}

export function stickerUrl(sticker: StickerEntry): string {
  return `${import.meta.env.BASE_URL}stickers/${sticker.file}`;
}

/**
 * 将气泡文本按贴图标记展开为渲染片段：
 * 已知标记成为贴图片段，未知标记直接从文本中剔除（避免原始标记泄漏到界面）。
 */
export function splitStickerPieces(text: string): StickerPiece[] {
  // 先剔除目录外标记，避免原始标记泄漏到界面，也避免其切断文本片段
  const cleaned = text.replace(new RegExp(STICKER_TOKEN.source, "gu"), (token, id: string) =>
    catalogById.has(id) ? token : "",
  );

  const pieces: StickerPiece[] = [];
  const regex = new RegExp(STICKER_TOKEN.source, "gu");
  let lastIndex = 0;
  let match: RegExpExecArray | null = null;

  const pushText = (segment: string) => {
    const trimmed = segment.trim();
    if (trimmed.length > 0) {
      pieces.push({ kind: "text", text: trimmed });
    }
  };

  while ((match = regex.exec(cleaned)) !== null) {
    const sticker = catalogById.get(match[1] ?? "");
    if (sticker === undefined) {
      continue;
    }
    pushText(cleaned.slice(lastIndex, match.index));
    pieces.push({ kind: "sticker", sticker });
    lastIndex = regex.lastIndex;
  }
  pushText(cleaned.slice(lastIndex));

  return pieces;
}

/** 流式期间隐藏尾部未闭合的贴图标记，避免气泡里露出半截 “[sticker:” */
export function stripPartialStickerToken(text: string): string {
  return text.replace(PARTIAL_STICKER_TOKEN, "");
}
