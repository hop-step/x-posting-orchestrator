import { Hono } from "hono";
import { consoleLogger } from "../shared/logger";
import { toErrorResponse } from "../shared/errors";
import { errorHandlerMiddleware } from "./middleware/error-handler";
import { optionalAuthMiddleware, requireAuthMiddleware } from "./middleware/auth";
import { requestIdMiddleware } from "./middleware/request-id";
import { adminRoutes } from "./routes/admin";
import { apiClientRoutes } from "./routes/api-clients";
import { healthRoutes } from "./routes/health";
import { mediaRoutes } from "./routes/media";
import { publicationRoutes } from "./routes/publications";
import { xAccountRoutes, xOAuthCallbackRoutes } from "./routes/x-accounts";
import type { AppBindings } from "./context";

export function createApp(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.onError((error, c) => {
    const requestId = c.get("requestId") ?? "req_unknown";
    c.get("logger")?.log("error", "http.error", { requestId, errorName: error.name });
    const response = toErrorResponse(error, requestId);
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: {
        "Content-Type": "application/json; charset=utf-8"
      }
    });
  });

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
    c.header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    if (c.req.method === "OPTIONS") {
      return c.body(null, 204);
    }
    await next();
  });
  app.route("/", adminRoutes());
  app.route("/", healthRoutes());
  app.route("/", xOAuthCallbackRoutes());
  app.use("/v1/*", optionalAuthMiddleware, requireAuthMiddleware);
  app.route("/", mediaRoutes());
  app.route("/", publicationRoutes());
  app.route("/", apiClientRoutes());
  app.route("/", xAccountRoutes());

  return app;
}
