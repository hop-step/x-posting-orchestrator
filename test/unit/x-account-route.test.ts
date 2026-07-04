import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { ApiClient } from "../../src/domain/auth/types";
import { scopes } from "../../src/domain/auth/types";
import type { Env } from "../../src/env";
import type { AppBindings } from "../../src/http/context";
import { xAccountRoutes } from "../../src/http/routes/x-accounts";
import { toErrorResponse } from "../../src/shared/errors";

class RecordingStatement {
  bindings: unknown[] = [];

  constructor(
    readonly query: string,
    private readonly db: RecordingD1
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.bindings = values;
    return this as unknown as D1PreparedStatement;
  }

  async first<T = unknown>(): Promise<T | null> {
    return (this.db.firstResults.shift() ?? null) as T | null;
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    return {
      success: true,
      results: (this.db.allResults.shift() ?? []) as T[],
      meta: {}
    } as unknown as D1Result<T>;
  }
}

class RecordingD1 {
  readonly statements: RecordingStatement[] = [];
  readonly batches: RecordingStatement[][] = [];
  readonly firstResults: unknown[] = [];
  readonly allResults: unknown[][] = [];

  prepare(query: string): D1PreparedStatement {
    const statement = new RecordingStatement(query, this);
    this.statements.push(statement);
    return statement as unknown as D1PreparedStatement;
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    this.batches.push(statements as unknown as RecordingStatement[]);
    return statements.map(() => ({ success: true, results: [], meta: {} }) as unknown as D1Result<T>);
  }
}

describe("x account routes", () => {
  it("creates an account and grants the creating client permission level 3 by default", async () => {
    const db = new RecordingD1();
    const app = new Hono<AppBindings>();
    const client = adminClient();

    app.use("*", async (c, next) => {
      c.set("requestId", "req_test");
      c.set("auth", { client, requestId: "req_test" });
      await next();
    });
    app.route("/", xAccountRoutes());

    const response = await app.request(
      "/v1/x/accounts",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          id: "acc_second",
          name: "Second Account",
          xUsername: "second_account"
        })
      },
      envWithDb(db)
    );

    expect(response.status).toBe(201);
    const json = await response.json<{
      account: { id: string; status: string };
      permission: { clientId: string; xAccountId: string; permissionLevel: number };
    }>();
    expect(json).toMatchObject({
      account: { id: "acc_second", status: "AUTH_ERROR" },
      permission: { clientId: "client_admin", xAccountId: "acc_second", permissionLevel: 3 }
    });

    const batch = db.batches.at(0);
    if (batch === undefined) {
      throw new Error("Expected D1 batch.");
    }
    expect(batch).toHaveLength(3);
    expect(batch[0]?.query).toContain("INSERT INTO x_accounts");
    expect(batch[1]?.query).toContain("INSERT INTO client_account_permissions");
    expect(batch[1]?.bindings).toEqual(["client_admin", "acc_second", 3, expect.any(Number), expect.any(Number)]);
    expect(batch[2]?.query).toContain("X_ACCOUNT_REGISTERED");
  });

  it("deletes an account when it has no active publications", async () => {
    const db = new RecordingD1();
    db.firstResults.push(accountRow("acc_delete"));
    db.allResults.push([]);
    const app = appWithAdminAuth();

    const response = await app.request("/v1/x/accounts/acc_delete", { method: "DELETE" }, envWithDb(db));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ account: { id: "acc_delete", status: "DELETED" } });
    const batch = db.batches.at(0);
    if (batch === undefined) {
      throw new Error("Expected D1 batch.");
    }
    expect(batch).toHaveLength(4);
    expect(batch[0]?.query).toContain("DELETE FROM client_account_permissions");
    expect(batch[1]?.query).toContain("DELETE FROM oauth_states");
    expect(batch[2]?.query).toContain("DELETE FROM x_accounts");
    expect(batch[3]?.query).toContain("X_ACCOUNT_DELETED");
  });

  it("blocks account deletion while publications still need action", async () => {
    const db = new RecordingD1();
    db.firstResults.push(accountRow("acc_active"));
    db.allResults.push([{ status: "SCHEDULED", count: 1 }]);
    const app = appWithAdminAuth();

    const response = await app.request("/v1/x/accounts/acc_active", { method: "DELETE" }, envWithDb(db));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "X_ACCOUNT_HAS_ACTIVE_PUBLICATIONS"
      }
    });
    expect(db.batches).toHaveLength(0);
  });
});

function appWithAdminAuth(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();
  const client = adminClient();
  app.onError((error) => {
    const response = toErrorResponse(error, "req_test");
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: {
        "Content-Type": "application/json; charset=utf-8"
      }
    });
  });
  app.use("*", async (c, next) => {
    c.set("requestId", "req_test");
    c.set("auth", { client, requestId: "req_test" });
    await next();
  });
  app.route("/", xAccountRoutes());
  return app;
}

function adminClient(): ApiClient {
  return {
    id: "client_admin",
    name: "Admin",
    actorType: "HUMAN",
    keyPrefix: "xps_admin",
    keyDigest: "digest",
    status: "ACTIVE",
    scopes: [...scopes],
    expiresAtMs: null,
    lastUsedAtMs: null,
    dailyRequestLimit: null,
    dailyPublishLimit: null,
    createdAtMs: 1,
    updatedAtMs: 1
  };
}

function envWithDb(db: RecordingD1): Env {
  return {
    DB: db as unknown as D1Database,
    PUBLISH_QUEUE: {} as Queue<never>,
    API_KEY_PEPPER: "pepper",
    PUBLIC_BASE_URL: "https://example.com",
    ALLOWED_CORS_ORIGINS: ""
  };
}

function accountRow(id: string): Record<string, unknown> {
  return {
    id,
    name: "Delete Me",
    x_user_id: null,
    x_username: null,
    status: "AUTH_ERROR",
    longform_capability: "UNKNOWN",
    self_reply_capability: "UNVERIFIED",
    access_token_ciphertext: null,
    access_token_iv: null,
    refresh_token_ciphertext: null,
    refresh_token_iv: null,
    token_key_version: null,
    access_token_expires_at_ms: null,
    scopes_json: "[]",
    created_at_ms: 1,
    updated_at_ms: 1
  };
}
