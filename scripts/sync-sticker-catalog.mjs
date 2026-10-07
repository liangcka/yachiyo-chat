import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const sourcePath = resolve("sticker-catalog.json");
const outputPaths = [
  resolve("src/features/sticker/catalog.gen.ts"),
  resolve("functions/_generated/sticker-catalog.ts"),
];

const ID_PATTERN = /^[a-z0-9-]+$/u;
const FILE_PATTERN = /^[a-z0-9-]+\.(?:png|jpe?g|gif|webp)$/u;

const raw = JSON.parse(await readFile(sourcePath, "utf8"));
const entries = raw.stickers;
if (!Array.isArray(entries) || entries.length === 0) {
  throw new Error("sticker-catalog.json 必须包含非空 stickers 数组");
}

const seen = new Set();
for (const entry of entries) {
  for (const field of ["id", "file", "alt", "scenes"]) {
    if (typeof entry[field] !== "string" || entry[field].length === 0) {
      throw new Error(`sticker-catalog.json 条目字段非法: ${field} (${entry.id ?? "?"})`);
    }
  }
  if (!ID_PATTERN.test(entry.id)) {
    throw new Error(`sticker id 仅允许小写字母数字与连字符: ${entry.id}`);
  }
  if (!FILE_PATTERN.test(entry.file)) {
    throw new Error(`sticker file 命名非法: ${entry.file}`);
  }
  if (seen.has(entry.id)) {
    throw new Error(`sticker id 重复: ${entry.id}`);
  }
  seen.add(entry.id);
}

const lines = entries
  .map(
    (entry) =>
      `  { id: ${JSON.stringify(entry.id)}, file: ${JSON.stringify(entry.file)}, alt: ${JSON.stringify(entry.alt)}, scenes: ${JSON.stringify(entry.scenes)} },`,
  )
  .join("\n");

const output = `// Generated from the root sticker-catalog.json. Do not edit.
export interface StickerEntry {
  /** [sticker:id] 标记中使用的唯一标识 */
  id: string;
  /** public/stickers/ 下的资产文件名 */
  file: string;
  /** 图像描述，用于 aria-label */
  alt: string;
  /** 适用场景，注入 system prompt 供模型自主判断 */
  scenes: string;
}

export const STICKER_CATALOG: readonly StickerEntry[] = [
${lines}
];
`;

for (const outputPath of outputPaths) {
  let existing;
  try {
    existing = await readFile(outputPath, "utf8");
  } catch {
    existing = undefined;
  }
  if (existing !== output) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, output, "utf8");
  }
}
