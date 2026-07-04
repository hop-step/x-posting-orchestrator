import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { ApiClient } from "../../src/domain/auth/types";
import type { Env } from "../../src/env";
import type { AppBindings } from "../../src/http/context";
import { apiClientRoutes } from "../../src/http/routes/api-clients";
import { toErrorResponse } from "../../src/shared/errors";
import { allScopes, client } from "../helpers/publication-fixtures";

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

describe("api client routes", () => {
  it("lists API clients with account permissions without exposing key digests", async () => {
    const db = new RecordingD1();
    db.allResults.push([
      apiClientRow({
        id: "client_ai",
        name: "External AI",
        actor_type: "AI",
        key_prefix: "xps_ai",
        scopes_json: JSON.stringify(["account:read", "publication:read"])
      })
    ]);
    db.allResults.push([
      {
        client_id: "client_ai",
        x_account_id: "acc_1",
        permission_level: 2,
        policy_id: null,
        max_thread_parts: 10,
        allowed_hours_json: null,
        created_at_ms: 1,
        updated_at_ms: 2,
        x_account_name: "Main",
        x_username: "main_account",
        x_account_status: "ACTIVE"
      }
    ]);
    const app = appWithAuth(client("client_admin", "HUMAN", allScopes));

    const response = await app.request("/v1/api-clients", {}, envWithDb(db));

    expect(response.status).toBe(200);
    const json = await response.json<{
      apiClients: Array<{ id: string; keyDigest?: string; keyPrefix: string; permissions: Array<{ xAccountId: string; permissionLevel: number }> }>;
    }>();
    expect(json.apiClients).toHaveLength(1);
    expect(json.apiClients[0]).toMatchObject({
      id: "client_ai",
      keyPrefix: "xps_ai",
      permissions: [{ xAccountId: "acc_1", permissionLevel: 2 }]
    });
    expect(json.apiClients[0]?.keyDigest).toBeUndefined();
  });

  it("creates an external AI client in the Worker using API_KEY_PEPPER", async () => {
    const db = new RecordingD1();
    db.firstResults.push({ id: "acc_1" });
    const app = appWithAuth(client("client_admin", "HUMAN", allScopes));

    const response = await app.request(
      "/v1/api-clients/ai",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: "external-kuma-touhan-x-daily",
          xAccountId: "acc_1"
        })
      },
      envWithDb(db)
    );

    expect(response.status).toBe(201);
    const json = await response.json<{
      apiClient: { id: string; name: string; actorType: string; keyPrefix: string; scopes: string[] };
      permission: { clientId: string; xAccountId: string; permissionLevel: number };
      apiKey: string;
    }>();
    expect(json.apiKey).toMatch(/^xps_[a-f0-9]{12}\.[a-f0-9]{64}$/u);
    expect(json.apiClient).toMatchObject({
      name: "external-kuma-touhan-x-daily",
      actorType: "AI",
      scopes: ["account:read", "publication:preview", "publication:create", "publication:read"]
    });
    expect(json.permission).toMatchObject({ xAccountId: "acc_1", permissionLevel: 2 });

    const batch = db.batches.at(0);
    if (batch === undefined) {
      throw new Error("Expected D1 batch.");
    }
    expect(batch).toHaveLength(3);
    expect(batch[0]?.query).toContain("INSERT INTO api_clients");
    expect(batch[0]?.bindings[4]).toBe(JSON.stringify(["account:read", "publication:preview", "publication:create", "publication:read"]));
    expect(batch[1]?.query).toContain("INSERT INTO client_account_permissions");
    expect(batch[1]?.bindings.slice(1, 4)).toEqual(["acc_1", 2, 10]);
    expect(batch[2]?.query).toContain("API_CLIENT_CREATED");
  });

  it("rejects AI callers even if they somehow have account management scope", async () => {
    const db = new RecordingD1();
    const app = appWithAuth(client("client_ai", "AI", ["account:manage"]));

    const response = await app.request(
      "/v1/api-clients/ai",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: "nested-ai",
          xAccountId: "acc_1"
        })
      },
      envWithDb(db)
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "AI_CLIENT_MANAGEMENT_FORBIDDEN"
      }
    });
    expect(db.batches).toHaveLength(0);
  });

  it("updates an account permission for a client", async () => {
    const db = new RecordingD1();
    db.firstResults.push(apiClientRow({ id: "client_ai", actor_type: "AI" }));
    db.firstResults.push({ id: "acc_1" });
    db.firstResults.push({ max_thread_parts: 8 });
    const app = appWithAuth(client("client_admin", "HUMAN", allScopes));

    const response = await app.request(
      "/v1/api-clients/client_ai/permissions/acc_1",
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          permissionLevel: 3,
          maxThreadParts: 12
        })
      },
      envWithDb(db)
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      permission: {
        clientId: "client_ai",
        xAccountId: "acc_1",
        permissionLevel: 3,
        maxThreadParts: 12
      }
    });
    const batch = db.batches.at(0);
    if (batch === undefined) {
      throw new Error("Expected D1 batch.");
    }
    expect(batch[0]?.query).toContain("INSERT INTO client_account_permissions");
    expect(batch[0]?.bindings.slice(0, 4)).toEqual(["client_ai", "acc_1", 3, 12]);
    expect(batch[1]?.query).toContain("CLIENT_ACCOUNT_PERMISSION_UPDATED");
  });

  it("rejects approval scopes when updating an AI client", async () => {
    const db = new RecordingD1();
    db.firstResults.push(apiClientRow({ id: "client_ai", actor_type: "AI" }));
    const app = appWithAuth(client("client_admin", "HUMAN", allScopes));

    const response = await app.request(
      "/v1/api-clients/client_ai",
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          scopes: ["publication:read", "publication:approve"]
        })
      },
      envWithDb(db)
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "AI_APPROVAL_SCOPE_FORBIDDEN"
      }
    });
    expect(db.batches).toHaveLength(0);
  });
});

function appWithAuth(apiClient: ApiClient): Hono<AppBindings> {
  const app = new Hono<AppBindings>();
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
    c.set("auth", { client: apiClient, requestId: "req_test" });
    await next();
  });
  app.route("/", apiClientRoutes());
  return app;
}

function envWithDb(db: RecordingD1): Env {
  return {
    DB: db as unknown as D1Database,
    PUBLISH_QUEUE: {} as Queue<never>,
    API_KEY_PEPPER: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    PUBLIC_BASE_URL: "https://example.com",
    ALLOWED_CORS_ORIGINS: ""
  };
}

function apiClientRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "client_1",
    name: "Client",
    actor_type: "SERVICE",
    key_prefix: "xps_client",
    status: "ACTIVE",
    scopes_json: JSON.stringify(["account:read"]),
    expires_at_ms: null,
    last_used_at_ms: null,
    daily_request_limit: null,
    daily_publish_limit: null,
    created_at_ms: 1,
    updated_at_ms: 1,
    ...overrides
  };
}
