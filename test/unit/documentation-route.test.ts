import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AppBindings } from "../../src/http/context";
import { createApp } from "../../src/http/app";
import { documentationRoutes } from "../../src/http/routes/documentation";

describe("documentation route", () => {
  it("requires Bearer authentication through the application middleware", async () => {
    const app = createApp("# Latest AI documentation");

    const response = await app.request("/v1/docs/ai", {}, { ALLOWED_CORS_ORIGINS: "" });

    expect(response.status).toBe(401);
  });

  it("serves the deployed AI handoff as uncached Markdown", async () => {
    const markdown = "# Latest AI documentation\n\nAlways preview before create.\n";
    const app = new Hono<AppBindings>();
    app.route("/", documentationRoutes(markdown));

    const response = await app.request("/v1/docs/ai");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Disposition")).toContain("external-ai-handoff.md");
    await expect(response.text()).resolves.toBe(markdown);
  });
});
