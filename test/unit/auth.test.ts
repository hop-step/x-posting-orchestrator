import { describe, expect, it } from "vitest";
import { assertScopesAllowedForActor, digestApiKey, parseBearerApiKey, verifyApiKeyDigest } from "../../src/domain/auth/api-keys";

describe("API key authentication", () => {
  it("parses xps API keys", () => {
    const parsed = parseBearerApiKey("Bearer xps_abc123.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(parsed.prefix).toBe("xps_abc123");
  });

  it("verifies HMAC digests without storing plaintext secrets", async () => {
    const key = "xps_test.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const digest = await digestApiKey("pepper", key);
    await expect(verifyApiKeyDigest("pepper", key, digest)).resolves.toBe(true);
    await expect(verifyApiKeyDigest("pepper", `${key}x`, digest)).resolves.toBe(false);
  });

  it("rejects approval scopes for AI actors at validation time", () => {
    expect(() => assertScopesAllowedForActor("AI", ["publication:create", "publication:approve"])).toThrow(
      /AI actors cannot have approval authority/
    );
  });
});
