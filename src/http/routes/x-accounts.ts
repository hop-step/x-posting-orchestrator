import { Hono } from "hono";
import { assertScope } from "../../domain/auth/api-keys";
import { D1AuthRepository } from "../../infrastructure/d1/repositories/auth-repository";
import type { AppBindings } from "../context";

export function xAccountRoutes(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.get("/v1/x/accounts", async (c) => {
    const auth = c.get("auth");
    if (auth === null) {
      throw new Error("auth middleware missing");
    }
    assertScope(auth.client.scopes, "account:read", auth.client.actorType);
    const rows = await c.env.DB.prepare(
      "SELECT id, name, x_user_id, x_username, status, longform_capability, self_reply_capability, created_at_ms, updated_at_ms FROM x_accounts ORDER BY created_at_ms DESC"
    ).all();
    return c.json({ accounts: rows.results });
  });

  app.get("/v1/x/accounts/:id", async (c) => {
    const auth = c.get("auth");
    if (auth === null) {
      throw new Error("auth middleware missing");
    }
    assertScope(auth.client.scopes, "account:read", auth.client.actorType);
    const repository = new D1AuthRepository(c.env.DB);
    const account = await repository.getXAccount(c.req.param("id"));
    if (account === null) {
      return c.notFound();
    }
    return c.json({ account });
  });

  return app;
}
