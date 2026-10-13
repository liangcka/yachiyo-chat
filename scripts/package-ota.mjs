import { Buffer } from "node:buffer";
import {
  constants,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  publicDecrypt,
  sign,
  verify,
} from "node:crypto";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { CapgoSDK, encryptBundle } from "@capgo/cli/sdk";

const appId = "app.yachiyo.chat";
const packageJson = fileURLToPath(new URL("../package.json", import.meta.url));
// SDK 的离线 zip 方法仍读取 apikey 参数；该占位值仅跳过本地账号查找，不用于上传。
const sdk = new CapgoSDK({ apikey: "local-offline-packaging" });

/** @param {string} version @returns {void} */
function validateVersion(version) {
  if (typeof version !== "string" || !/^\d{14}$/.test(version))
    throw new Error("资源版本必须为 14 位 UTC 时间：yyyyMMddHHmmss。");
  const iso = `${version.slice(0, 4)}-${version.slice(4, 6)}-${version.slice(6, 8)}T${version.slice(8, 10)}:${version.slice(10, 12)}:${version.slice(12, 14)}Z`;
  const timestamp = new Date(iso);
  if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString().replace(/\D/g, "").slice(0, 14) !== version)
    throw new Error("资源版本必须对应有效的 UTC 时间。");
}

/** @param {string} path @returns {Promise<unknown>} */
async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {string} value @returns {Buffer} */
function decodeChecksum(value) {
  if (/^(?:[0-9a-f]{2})+$/i.test(value)) return Buffer.from(value, "hex");
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value)
    throw new Error("官方 SDK 返回了不支持的加密校验值编码。");
  return decoded;
}

/**
 * 发布前用 APK 公钥验证官方 SDK 的密文格式，防止 SDK 升级产生不可安装资源包。
 * @param {Buffer} encryptedZip @param {string} session @param {string} checksum
 * @param {import("node:crypto").KeyObject} publicKey @param {Buffer} expectedZip
 * @returns {void}
 */
function verifyEncryptedBundle(encryptedZip, session, checksum, publicKey, expectedZip) {
  const [iv, encryptedSessionKey, extra] = session.split(":");
  if (!iv || !encryptedSessionKey || extra !== undefined)
    throw new Error("官方 SDK 返回了不支持的会话密钥格式。");
  const options = { key: publicKey, padding: constants.RSA_PKCS1_PADDING };
  const sessionKey = publicDecrypt(options, Buffer.from(encryptedSessionKey, "base64"));
  const decipher = createDecipheriv("aes-128-cbc", sessionKey, Buffer.from(iv, "base64"));
  const zip = Buffer.concat([decipher.update(encryptedZip), decipher.final()]);
  const digest = publicDecrypt(options, decodeChecksum(checksum));
  if (digest.length !== 32 || !digest.equals(createHash("sha256").update(zip).digest()) || !zip.equals(expectedZip))
    throw new Error("官方 SDK 加密包或 SHA-256 校验格式与当前 APK 不兼容。");
}

/**
 * 构建经安装公钥验证的 OTA 包与签名清单；不上传、不修改安装公钥。
 * @param {{projectRoot?: string, environment?: NodeJS.ProcessEnv}} [options]
 * @returns {Promise<{bundlePath: string, manifestPath: string, version: string, tag: string}>}
 */
export async function packageOta({ projectRoot = process.cwd(), environment = process.env } = {}) {
  const root = resolve(projectRoot);
  const release = await readJson(join(root, "mobile-release.json"));
  if (!isRecord(release) || typeof release.nativeVersion !== "string" ||
      !/^\d+\.\d+\.\d+$/.test(release.nativeVersion) || !Number.isSafeInteger(release.nativeBuild) ||
      Number(release.nativeBuild) < 1 || typeof release.runtimeVersion !== "string" ||
      !/^[a-z0-9-]+$/.test(release.runtimeVersion) || typeof release.bundleVersion !== "string")
    throw new Error("mobile-release.json 缺少有效的原生版本与运行时配置。");
  const version = environment.VITE_BUNDLE_VERSION || release.bundleVersion;
  validateVersion(version);
  const tag = environment.OTA_TAG || `v${release.nativeVersion}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(tag) || tag.includes(".."))
    throw new Error("发布标签只能包含字母、数字、点、下划线与连字符。");

  const dist = join(root, "dist");
  const marker = await readJson(join(dist, "bundle-info.json"));
  if (!isRecord(marker) || marker.version !== version || marker.runtimeVersion !== release.runtimeVersion ||
      marker.nativeBuild !== release.nativeBuild)
    throw new Error("构建标记与发布版本不一致，请使用相同 VITE_BUNDLE_VERSION 重新构建。");
  await readFile(join(dist, "index.html"));
  const publicKey = createPublicKey(await readFile(join(root, "src", "update", "public-key.txt"), "utf8"));
  const privateKey = createPrivateKey(environment.OTA_PRIVATE_KEY ||
    await readFile(join(root, ".ota", "private-key.pem"), "utf8"));
  if (privateKey.asymmetricKeyType !== "rsa" || !createPublicKey(privateKey).export({ type: "spki", format: "der" })
    .equals(publicKey.export({ type: "spki", format: "der" })))
    throw new Error("发布私钥与 APK 内置公钥不匹配，停止生成资源包。");

  const artifactDirectory = join(root, ".ota", "artifacts");
  await mkdir(artifactDirectory, { recursive: true });
  const stage = await mkdtemp(join(root, ".ota", "package-"));
  const stageRelative = relative(join(root, ".ota"), resolve(stage));
  if (stageRelative.startsWith("..") || isAbsolute(stageRelative) || !/^package-[^/\\]+$/.test(stageRelative))
    throw new Error("拒绝清理 OTA 工作目录之外的路径。");
  try {
    // SDK 的 bundle 参数遵循 semver；客户端资源版本由签名清单与构建标记定义。
    const zipped = await sdk.zipBundle({
      appId, path: dist, bundle: release.nativeVersion, name: join(stage, "web.zip"),
      keyV2: true, packageJson,
    });
    if (!zipped.success || !zipped.data) throw new Error("官方 SDK 打包失败。");
    const encrypted = await encryptBundle({
      zipPath: zipped.data.filename,
      checksum: zipped.data.checksum,
      keyData: privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
      packageJson,
    });
    if (!encrypted.success || !encrypted.data) throw new Error("官方 SDK 加密失败。");
    const data = encrypted.data;
    const encryptedZip = await readFile(data.filename);
    verifyEncryptedBundle(encryptedZip, data.ivSessionKey, data.checksum, publicKey,
      await readFile(zipped.data.filename));
    const filename = `yachiyo-web-${version}.zip`;
    const payload = JSON.stringify({
      schemaVersion: 1, appId, platform: "android", runtimeVersion: release.runtimeVersion,
      nativeVersion: release.nativeVersion, nativeBuild: release.nativeBuild, version,
      url: `https://github.com/liangcka/yachiyo-chat/releases/download/${tag}/${filename}`,
      checksum: data.checksum, sessionKey: data.ivSessionKey,
    });
    const signature = sign("RSA-SHA256", Buffer.from(payload), privateKey);
    if (!verify("RSA-SHA256", Buffer.from(payload), publicKey, signature))
      throw new Error("资源清单签名验证失败。");
    const bundlePath = join(artifactDirectory, filename);
    const manifestPath = join(artifactDirectory, "app-update.json");
    await copyFile(data.filename, bundlePath);
    await writeFile(manifestPath, `${JSON.stringify({ payload, signature: signature.toString("base64") }, null, 2)}\n`);
    return { bundlePath, manifestPath, version, tag };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await packageOta();
    console.log(`OTA ${result.version} 已生成：${result.bundlePath}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "OTA 打包失败。");
    process.exitCode = 1;
  }
}
