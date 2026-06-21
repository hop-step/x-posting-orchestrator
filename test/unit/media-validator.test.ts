import { describe, expect, it } from "vitest";
import { validateImageBytes } from "../../src/domain/media/media-validator";
import { AppError } from "../../src/shared/errors";
import { testConfig } from "../helpers/publication-fixtures";

describe("media validator", () => {
  it("detects allowed image types by magic bytes", async () => {
    await expect(validateImageBytes(new Uint8Array([0xff, 0xd8, 0xff, 0x00]), testConfig)).resolves.toMatchObject({ mimeType: "image/jpeg" });
    await expect(validateImageBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), testConfig)).resolves.toMatchObject({
      mimeType: "image/png"
    });
    await expect(validateImageBytes(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]), testConfig)).resolves.toMatchObject({
      mimeType: "image/webp"
    });
  });

  it("rejects unsupported image bytes and oversize files", async () => {
    await expect(validateImageBytes(new Uint8Array([1, 2, 3]), testConfig)).rejects.toThrow(AppError);
    await expect(validateImageBytes(new Uint8Array(testConfig.maxImageBytes + 1), testConfig)).rejects.toThrow(AppError);
  });
});
