/** 按Unicode 码点截断，避免切开代理对 */
export function truncateUnicode(value: string, maximum: number): string {
  return [...value].slice(0, maximum).join("");
}

function codePointText(codePoint: number): string {
  return Number.isInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : "";
}

/** 解码常见命名实体与十进制/十六进制数字实体；&amp; 必须放在最后，避免二次解码 */
export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/giu, (_match, hex: string) =>
      codePointText(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/gu, (_match, decimal: string) =>
      codePointText(Number.parseInt(decimal, 10)),
    )
    .replace(/&nbsp;/gu, " ")
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&amp;/gu, "&");
}
