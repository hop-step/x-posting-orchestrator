import { describe, expect, it } from "vitest";
import type { Env } from "../../src/env";
import { discordRoutes } from "../../src/http/routes/discord";

describe("Discord interaction route", () => {
  it("does not act on legacy approval buttons and directs users to admin", async () => {
    const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
    const publicKey = bytesToHex(new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey)));
    const timestamp = "1786440000";
    const body = JSON.stringify({
      type: 3,
      data: { custom_id: "xpo:approve:pub_legacy:1" }
    });
    const message = new TextEncoder().encode(timestamp + body);
    const signature = bytesToHex(new Uint8Array(await crypto.subtle.sign("Ed25519", keyPair.privateKey, message)));

    const response = await discordRoutes().request(
      "/v1/discord/interactions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Signature-Ed25519": signature,
          "X-Signature-Timestamp": timestamp
        },
        body
      },
      env({ DISCORD_PUBLIC_KEY: publicKey })
    );

    expect(response.status).toBe(200);
    const responseText = await response.text();
    expect(responseText).toContain('"type":4');
    expect(responseText).toContain("管理画面");
    expect(responseText).toContain('"flags":64');
  });
});

function env(overrides: Partial<Env> = {}): Env {
  return {
    DB: new Proxy({} as D1Database, {
      get: () => {
        throw new Error("Discord legacy buttons must not access D1.");
      }
    }),
    PUBLISH_QUEUE: {} as Queue<never>,
    API_KEY_PEPPER: "pepper",
    PUBLIC_BASE_URL: "https://example.com",
    ...overrides
  };
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
