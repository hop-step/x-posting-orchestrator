export type MediaMimeType = "image/jpeg" | "image/png" | "image/webp";
export type MediaStatus = "READY" | "EXPIRED" | "DELETED";

export interface MediaAsset {
  id: string;
  xAccountId: string;
  createdByClientId: string;
  r2Key: string;
  originalFilename: string | null;
  mimeType: MediaMimeType;
  sizeBytes: number;
  sha256: string;
  altText: string | null;
  aiGenerated: boolean;
  status: MediaStatus;
  expiresAtMs: number | null;
  createdAtMs: number;
  updatedAtMs: number;
}
