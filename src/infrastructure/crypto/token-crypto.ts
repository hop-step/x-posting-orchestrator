import { bytesToHex } from "../../shared/crypto";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface EncryptedValue {
  ciphertext: string;
  iv: string;
}

export async function encryptToken(plaintext: string, secret: string): Promise<EncryptedValue> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importAesKey(secret);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(plaintext));
  return {
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    iv: bytesToHex(iv)
  };
}

export async function decryptToken(value: EncryptedValue, secret: string): Promise<string> {
  const iv = hexToBytes(value.iv);
  const key = await importAesKey(secret);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: toArrayBuffer(iv) }, key, toArrayBuffer(base64ToBytes(value.ciphertext)));
  return decoder.decode(decrypted);
}

async function importAesKey(secret: string): Promise<CryptoKey> {
  const raw = parseSecret(secret);
  if (raw.byteLength !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY_V1 must decode to 32 bytes.");
  }
  return crypto.subtle.importKey("raw", toArrayBuffer(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function parseSecret(secret: string): Uint8Array {
  if (/^[a-f0-9]{64}$/iu.test(secret)) {
    return hexToBytes(secret);
  }
  return base64ToBytes(secret);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function hexToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
