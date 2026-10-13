import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import {
  constants,
  createDecipheriv,
  createHash,
  generateKeyPairSync,
  publicDecrypt,
  verify,
} from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import test from "node:test";
import { packageOta } from "./package-ota.mjs";

const release = {
  nativeVersion: "0.1.13",
  nativeBuild: 13,
  runtimeVersion: "android-1",
  bundleVersion: "20261013160000",
};
const keys = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { format: "pem", type: "spki" },
  privateKeyEncoding: { format: "pem", type: "pkcs1" },
});

async function fixture(t, marker = {}) {
  const projectRoot = await mkdtemp(join(tmpdir(), "yachiyo-ota-test-"));
  t.after(async () => {
    const temporaryRelative = relative(resolve(tmpdir()), resolve(projectRoot));
    assert.equal(isAbsolute(temporaryRelative), false);
    assert.match(temporaryRelative, /^yachiyo-ota-test-[^/\\]+$/);
    await rm(projectRoot, { recursive: true, force: true });
  });
  await Promise.all([
    mkdir(join(projectRoot, "dist", "assets"), { recursive: true }),
    mkdir(join(projectRoot, "src", "update"), { recursive: true }),
    mkdir(join(projectRoot, ".ota"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(projectRoot, "mobile-release.json"), JSON.stringify(release)),
    writeFile(join(projectRoot, "src", "update", "public-key.txt"), keys.publicKey),
    writeFile(join(projectRoot, ".ota", "private-key.pem"), keys.privateKey),
    writeFile(join(projectRoot, "dist", "index.html"), '<script src="./assets/app.js"></script>'),
    writeFile(join(projectRoot, "dist", "assets", "app.js"), "void 'notifyAppReady';"),
    writeFile(join(projectRoot, "dist", "bundle-info.json"), JSON.stringify({
      version: release.bundleVersion,
      runtimeVersion: release.runtimeVersion,
      nativeBuild: release.nativeBuild,
      ...marker,
    })),
  ]);
  return projectRoot;
}

test("官方 SDK 资源包能以安装公钥解密、校验，清单签名保护全部发布字段", async (t) => {
  const projectRoot = await fixture(t);
  const result = await packageOta({ projectRoot, environment: {} });
  const envelope = JSON.parse(await readFile(result.manifestPath, "utf8"));
  assert.equal(verify("RSA-SHA256", Buffer.from(envelope.payload), keys.publicKey,
    Buffer.from(envelope.signature, "base64")), true);
  assert.equal(verify("RSA-SHA256", Buffer.from(`${envelope.payload} `), keys.publicKey,
    Buffer.from(envelope.signature, "base64")), false);

  const manifest = JSON.parse(envelope.payload);
  assert.deepEqual({ ...manifest, checksum: undefined, sessionKey: undefined }, {
    schemaVersion: 1,
    appId: "app.yachiyo.chat",
    platform: "android",
    runtimeVersion: release.runtimeVersion,
    nativeVersion: release.nativeVersion,
    nativeBuild: release.nativeBuild,
    version: release.bundleVersion,
    url: `https://github.com/liangcka/yachiyo-chat/releases/download/v0.1.13/yachiyo-web-${release.bundleVersion}.zip`,
    checksum: undefined,
    sessionKey: undefined,
  });

  const [iv, encryptedSessionKey] = manifest.sessionKey.split(":");
  const sessionKey = publicDecrypt({ key: keys.publicKey, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(encryptedSessionKey, "base64"));
  assert.equal(sessionKey.length, 16);
  const decipher = createDecipheriv("aes-128-cbc", sessionKey, Buffer.from(iv, "base64"));
  const encryptedZip = await readFile(result.bundlePath);
  const zip = Buffer.concat([decipher.update(encryptedZip), decipher.final()]);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  const checksumEncoding = /^[0-9a-f]{512}$/i.test(manifest.checksum) ? "hex" : "base64";
  const digest = publicDecrypt({ key: keys.publicKey, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(manifest.checksum, checksumEncoding));
  assert.equal(digest.length, 32);
  assert.deepEqual(digest, createHash("sha256").update(zip).digest());
  assert.equal(encryptedZip.includes(Buffer.from("notifyAppReady")), false);
});

test("环境变量覆盖发布版本和标签，私钥只从发布环境读取", async (t) => {
  const version = "20261014170000";
  const projectRoot = await fixture(t, { version });
  await rm(join(projectRoot, ".ota", "private-key.pem"));
  const result = await packageOta({ projectRoot, environment: {
    VITE_BUNDLE_VERSION: version,
    OTA_TAG: `ota-${version}-abc1234`,
    OTA_PRIVATE_KEY: keys.privateKey,
  } });
  const envelope = JSON.parse(await readFile(result.manifestPath, "utf8"));
  const manifest = JSON.parse(envelope.payload);
  assert.equal(manifest.version, version);
  assert.equal(manifest.url,
    `https://github.com/liangcka/yachiyo-chat/releases/download/ota-${version}-abc1234/yachiyo-web-${version}.zip`);
});

test("拒绝与资源包版本或原生运行时不一致的构建产物", async (t) => {
  for (const marker of [{ version: "20261012160000" }, { runtimeVersion: "android-2" }, { nativeBuild: 12 }]) {
    const projectRoot = await fixture(t, marker);
    await assert.rejects(packageOta({ projectRoot, environment: {} }), /构建标记/);
  }
});

test("拒绝不能被现有 APK 公钥验证的发布私钥", async (t) => {
  const projectRoot = await fixture(t);
  const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privateKey = other.privateKey.export({ format: "pem", type: "pkcs1" });
  await assert.rejects(packageOta({ projectRoot, environment: { OTA_PRIVATE_KEY: privateKey } }), /公钥不匹配/);
});

test("拒绝无效 UTC 资源版本与可改变下载地址结构的标签", async (t) => {
  const projectRoot = await fixture(t);
  for (const version of ["1.0.0", "20260230160000", "2026101316000"])
    await assert.rejects(packageOta({ projectRoot, environment: { VITE_BUNDLE_VERSION: version } }), /UTC/);
  await assert.rejects(packageOta({ projectRoot, environment: { OTA_TAG: "../other/release" } }), /标签/);
});
