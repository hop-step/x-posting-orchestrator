import { Hono } from "hono";
import type { AppBindings } from "../context";

export function healthRoutes(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();
  app.get("/healthz", (c) =>
    c.json({
      ok: true,
      service: "x-posting-orchestrator"
    })
  );
  return app;
}
