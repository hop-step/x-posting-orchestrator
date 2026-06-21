import type { AppConfig } from "../../env";
import { sha256Hex } from "../../shared/crypto";
import { unprocessable } from "../../shared/errors";
import type { MediaMimeType } from "./entities";

export interface ValidatedMedia {
  mimeType: MediaMimeType;
  sizeBytes: number;
  sha256: string;
}

export async function validateImageBytes(bytes: Uint8Array, config: AppConfig): Promise<ValidatedMedia> {
  if (bytes.byteLength > config.maxImageBytes) {
    throw unprocessable("MEDIA_TOO_LARGE", "Image exceeds maximum size.", { maxImageBytes: config.maxImageBytes });
  }
  const mimeType = detectMimeType(bytes);
  if (mimeType === null) {
    throw unprocessable("MEDIA_TYPE_UNSUPPORTED", "Only JPEG, PNG, and WEBP images are supported.");
  }
  return {
    mimeType,
    sizeBytes: bytes.byteLength,
    sha256: await sha256Hex(bytes)
  };
}

function detectMimeType(bytes: Uint8Array): MediaMimeType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}
