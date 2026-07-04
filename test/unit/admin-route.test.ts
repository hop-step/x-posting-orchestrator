import { describe, expect, it } from "vitest";
import { createApp } from "../../src/http/app";

describe("admin route", () => {
  it("requires Basic authentication", async () => {
    const app = createApp();
    const response = await app.request(
      "/admin",
      {},
      {
        ADMIN_BASIC_USERNAME: "admin",
        ADMIN_BASIC_PASSWORD: "secret",
        ALLOWED_CORS_ORIGINS: ""
      }
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Basic");
  });

  it("serves the lightweight admin UI", async () => {
    const app = createApp();
    const response = await app.request(
      "/admin",
      {
        headers: {
          Authorization: `Basic ${Buffer.from("admin:secret").toString("base64")}`
        }
      },
      {
        ADMIN_BASIC_USERNAME: "admin",
        ADMIN_BASIC_PASSWORD: "secret",
        ALLOWED_CORS_ORIGINS: ""
      }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("X Posting Admin");
    expect(html).toContain("Xアカウント");
    expect(html).toContain("/v1/x/accounts");
    expect(html).toContain("X接続");
    expect(html).toContain('method: "DELETE"');
    expect(html).toContain("APIクライアント");
    expect(html).toContain("/v1/api-clients");
    expect(html).toContain("clientCardFor");
    expect(html).toContain("updateApiClient");
    expect(html).toContain("updateClientPermission");
    expect(html).toContain("permissionLevels");
    expect(html).toContain("/v1/publications?limit=100");
    expect(html).toContain('<ul class="publication-list" id="rows">');
    expect(html).toContain("publicationCardFor");
    expect(html).toContain("card-title-row");
    expect(html).toContain("card-date");
    expect(html).toContain("compactMeta");
    expect(html).toContain("step-block");
    expect(html).toContain("full-step-text");
    expect(html).toContain("投稿前Step");
    expect(html).toContain("groupPublicationsForRows");
    expect(html).toContain("Step2以降 ");
    expect(html).toContain("step-children");
    expect(html).toContain("step-list");
    expect(html).toContain("compact-details");
    expect(html).toContain("formatDurationMinutes");
    expect(html).toContain("memoCompactMeta");
    expect(html).toContain("Publication ID:");
    expect(html).toContain("approvalGraceSeconds");
    expect(html).toContain("approvalBannerFor");
    expect(html).toContain("approvePublication");
    expect(html).toContain("/approve");
    expect(html).toContain("承認待ち");
    expect(html).toContain("期限切れ");
    expect(html).toContain("承認しました");
    expect(html).toContain("splitPreviewAndContinuation");
    expect(html).toContain("previewCutIndex");
    expect(html).toContain("続き");
    expect(html).not.toContain("全文");
    expect(html).not.toContain("ID / Step");
    expect(html).not.toContain("xAccountId=acc_main");
  });
});
