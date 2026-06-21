import { createMiddleware } from "hono/factory";
import type { AppBindings } from "../context";

export const requestIdMiddleware = createMiddleware<AppBindings>(async (c, next) => {
  const requestId = c.req.header("X-Request-Id") ?? `req_${crypto.randomUUID()}`;
  c.set("requestId", requestId);
  await next();
  c.header("X-Request-Id", requestId);
});
