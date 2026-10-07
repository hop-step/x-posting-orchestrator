import { Hono } from "hono";
import type { AppBindings } from "../context";

export function documentationRoutes(aiDocumentationMarkdown: string): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.get("/v1/docs/ai", (c) =>
    c.body(aiDocumentationMarkdown, 200, {
      "Cache-Control": "private, no-store",
      "Content-Disposition": 'inline; filename="external-ai-handoff.md"',
      "Content-Type": "text/markdown; charset=utf-8",
      "X-Content-Type-Options": "nosniff"
    })
  );

  return app;
}
