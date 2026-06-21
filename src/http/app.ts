import { Hono } from "hono";
import { consoleLogger } from "../shared/logger";
import { errorHandlerMiddleware } from "./middleware/error-handler";
import { optionalAuthMiddleware, requireAuthMiddleware } from "./middleware/auth";
import { requestIdMiddleware } from "./middleware/request-id";
import { healthRoutes } from "./routes/health";
import { publicationRoutes } from "./routes/publications";
import { xAccountRoutes } from "./routes/x-accounts";
import type { AppBindings } from "./context";

export function createApp(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.use("*", async (c, next) => {
    c.set("logger", consoleLogger);
    await next();
  });
  app.use("*", requestIdMiddleware);
  app.use("*", errorHandlerMiddleware);
  app.use("*", async (c, next) => {
    const allowlist = (c.env.ALLOWED_CORS_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);
    const origin = c.req.header("Origin");
    if (allowlist.length === 0 || origin === undefined || !allowlist.includes(origin)) {
      await next();
      return;
    }
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Vary", "Origin");
    c.header("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key, X-Request-Id");
    c.header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
    if (c.req.method === "OPTIONS") {
      return c.body(null, 204);
    }
    await next();
  });
  app.route("/", healthRoutes());
  app.use("/v1/*", optionalAuthMiddleware, requireAuthMiddleware);
  app.route("/", publicationRoutes());
  app.route("/", xAccountRoutes());

  return app;
}
