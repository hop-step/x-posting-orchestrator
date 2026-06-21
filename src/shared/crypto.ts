import { canonicalJson } from "./canonical-json";

const textEncoder = new TextEncoder();

export async function sha256Hex(input: string | ArrayBuffer | Uint8Array): Promise<string> {
  const data =
    typeof input === "string"
      ? textEncoder.encode(input)
      : input instanceof Uint8Array
        ? input
        : new Uint8Array(input);
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(data));
  return bytesToHex(new Uint8Array(digest));
}

export async function sha256Canonical(value: unknown): Promise<string> {
  return sha256Hex(canonicalJson(value));
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, toArrayBuffer(textEncoder.encode(message)));
  return bytesToHex(new Uint8Array(signature));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function constantTimeEqual(a: string, b: string): boolean {
  const aBytes = textEncoder.encode(a);
  const bBytes = textEncoder.encode(b);
  const max = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < max; i += 1) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

export function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
