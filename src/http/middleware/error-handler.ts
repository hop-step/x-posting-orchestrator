import { createMiddleware } from "hono/factory";
import { toErrorResponse } from "../../shared/errors";
import type { AppBindings } from "../context";

export const errorHandlerMiddleware = createMiddleware<AppBindings>(async (c, next) => {
  try {
    await next();
  } catch (error) {
    const requestId = c.get("requestId") ?? "req_unknown";
    const logger = c.get("logger");
    logger?.log("error", "http.error", { requestId, errorName: error instanceof Error ? error.name : "unknown" });
    const response = toErrorResponse(error, requestId);
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: {
        "Content-Type": "application/json; charset=utf-8"
      }
    });
  }
});
