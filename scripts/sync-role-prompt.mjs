import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const sourcePath = resolve("角色提示词.txt");
const outputPath = resolve("functions/_generated/role-prompt.ts");
const source = await readFile(sourcePath, "utf8");
const literal = JSON.stringify(source)
  .replaceAll("\u2028", "\\u2028")
  .replaceAll("\u2029", "\\u2029");
const output = `// Generated from the root canonical role prompt. Do not edit.\nconst rolePrompt = ${literal};\nexport default rolePrompt;\n`;

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
