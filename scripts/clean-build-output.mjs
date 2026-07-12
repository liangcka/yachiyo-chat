import { rm } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

const projectRoot = resolve();
const outputDirectory = resolve(projectRoot, "dist");
const relativeOutput = relative(projectRoot, outputDirectory);

if (
  relativeOutput.length === 0 ||
  relativeOutput.startsWith("..") ||
  isAbsolute(relativeOutput)
) {
  throw new Error("Refusing to clean a build directory outside the project root.");
}

await rm(outputDirectory, { force: true, recursive: true });
