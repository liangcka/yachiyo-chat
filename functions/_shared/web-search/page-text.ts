import { decodeHtmlEntities } from "./text";

/**
 * 从 HTML 提取可读正文文本（纯正则实现，保证 vitest node 环境可测，不依赖 HTMLRewriter）：
 * 去注释、脚本/样式/模板块与语义性非正文区（nav/header/footer/aside/form），
 * 块级闭合标签与 <br> 转换行，剥其余标签，解码实体后压缩空白。
 */
export function extractPageText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<!--[\s\S]*?-->/gu, " ")
      .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1\s*>/giu, " ")
      .replace(/<(nav|header|footer|aside|form)\b[\s\S]*?<\/\1\s*>/giu, " ")
      .replace(/<br\s*\/?\s*>/giu, "\n")
      .replace(
        /<\/(?:p|div|li|ul|ol|tr|td|th|section|article|main|h[1-6]|blockquote|pre|figure|figcaption|dl|dt|dd)\s*>/giu,
        "\n",
      )
      .replace(/<[^>]*>/gu, " "),
  )
    .replace(/[ \t\f\v\u00a0]+/gu, " ")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n[ \t]+/gu, "\n")
    .replace(/\n{2,}/gu, "\n")
    .trim();
}
