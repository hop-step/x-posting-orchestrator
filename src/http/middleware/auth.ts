import { createMiddleware } from "hono/factory";
import { D1AuthRepository } from "../../infrastructure/d1/repositories/auth-repository";
import { assertAuthenticatedClientActive } from "../../domain/auth/authorization";
import { parseBearerApiKey, verifyApiKeyDigest } from "../../domain/auth/api-keys";
import { unauthorized } from "../../shared/errors";
import type { AppBindings } from "../context";

export const optionalAuthMiddleware = createMiddleware<AppBindings>(async (c, next) => {
  const authorization = c.req.header("Authorization");
  if (authorization === undefined) {
    c.set("auth", null);
    await next();
    return;
  }
  const parsed = parseBearerApiKey(authorization);
  const repository = new D1AuthRepository(c.env.DB);
  const client = await repository.getClientByKeyPrefix(parsed.prefix);
  if (client === null) {
    throw unauthorized();
  }
  assertAuthenticatedClientActive(client, Date.now());
  const ok = await verifyApiKeyDigest(c.env.API_KEY_PEPPER, parsed.fullKey, client.keyDigest);
  if (!ok) {
    throw unauthorized();
  }
  await repository.updateClientLastUsed(client.id, Date.now());
  c.set("auth", { client, requestId: c.get("requestId") });
  await next();
});

export const requireAuthMiddleware = createMiddleware<AppBindings>(async (c, next) => {
  const auth = c.get("auth");
  if (auth === null) {
    throw unauthorized();
  }
  await next();
});
