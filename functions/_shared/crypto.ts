const textEncoder = new TextEncoder();

export function utf8Bytes(value: string): Uint8Array<ArrayBuffer> {
  return textEncoder.encode(value);
}

export function bytesToHex(value: Uint8Array): string {
  let result = "";
  for (const byte of value) {
    result += byte.toString(16).padStart(2, "0");
  }
  return result;
}

export function hexToBytes(value: string): Uint8Array<ArrayBuffer> {
  if (value.length % 2 !== 0 || !/^[a-f0-9]+$/i.test(value)) {
    throw new TypeError("Invalid hexadecimal value");
  }

  const result = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    result[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return result;
}

export function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  const comparedLength = Math.max(left.length, right.length);

  for (let index = 0; index < comparedLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }

  return difference === 0;
}

export async function sha256Bytes(
  value: string | Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  const input = typeof value === "string" ? utf8Bytes(value) : value;
  const ownedInput = new Uint8Array(input);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", ownedInput.buffer));
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  return bytesToHex(await sha256Bytes(value));
}

export async function hmacSha256(
  secret: string,
  message: string | Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey(
    "raw",
    utf8Bytes(secret).buffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const input = typeof message === "string" ? utf8Bytes(message) : message;
  const ownedInput = new Uint8Array(input);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, ownedInput.buffer));
}

export function base64UrlEncode(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/u.test(value)) {
    throw new TypeError("Invalid base64url value");
  }

  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const result = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    result[index] = binary.charCodeAt(index);
  }

  return result;
}
