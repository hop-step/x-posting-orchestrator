import { Hono } from "hono";
import { z } from "zod";
import { assertScope, assertScopesAllowedForActor, digestApiKey } from "../../domain/auth/api-keys";
import { scopes, type ActorType, type ApiClientStatus, type Scope } from "../../domain/auth/types";
import { badRequest, forbidden, notFound } from "../../shared/errors";
import { randomHex } from "../../shared/ids";
import type { AppBindings } from "../context";

const externalAiDefaultScopes = ["account:read", "publication:preview", "publication:create", "publication:read"] satisfies Scope[];
const externalAiForbiddenScopes = new Set<Scope>(["publication:approve", "publication:reject", "publication:reconcile", "publication:retry", "account:manage"]);

const createExternalAiClientSchema = z.object({
  name: z.string().min(1).max(120),
  xAccountId: z.string().min(1),
  scopes: z.array(z.enum(scopes)).optional().default(externalAiDefaultScopes),
  permissionLevel: z.number().int().min(0).max(3).optional().default(2),
  dailyRequestLimit: z.number().int().positive().nullable().optional().default(100),
  dailyPublishLimit: z.number().int().positive().nullable().optional().default(20),
  maxThreadParts: z.number().int().positive().max(25).optional().default(10)
});

const updateApiClientSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    status: z.enum(["ACTIVE", "DISABLED"]).optional(),
    scopes: z.array(z.enum(scopes)).optional(),
    dailyRequestLimit: z.number().int().positive().nullable().optional(),
    dailyPublishLimit: z.number().int().positive().nullable().optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required."
  });

const upsertClientPermissionSchema = z.object({
  permissionLevel: z.number().int().min(0).max(3),
  maxThreadParts: z.number().int().positive().max(25).optional()
});

interface ApiClientRow {
  id: string;
  name: string;
  actor_type: ActorType;
  key_prefix: string;
  status: ApiClientStatus;
  scopes_json: string;
  expires_at_ms: number | null;
  last_used_at_ms: number | null;
  daily_request_limit: number | null;
  daily_publish_limit: number | null;
  created_at_ms: number;
  updated_at_ms: number;
}

interface ClientPermissionRow {
  client_id: string;
  x_account_id: string;
  permission_level: 0 | 1 | 2 | 3;
  policy_id: string | null;
  max_thread_parts: number;
  allowed_hours_json: string | null;
  created_at_ms: number;
  updated_at_ms: number;
  x_account_name: string | null;
  x_username: string | null;
  x_account_status: string | null;
}

export function apiClientRoutes(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.get("/v1/api-clients", async (c) => {
    const auth = c.get("auth");
    if (auth === null) {
      throw new Error("auth middleware missing");
    }
    assertScope(auth.client.scopes, "account:manage", auth.client.actorType);
    if (auth.client.actorType === "AI") {
      throw forbidden("AI_CLIENT_MANAGEMENT_FORBIDDEN", "AI actors cannot manage API clients.");
    }

    const [clientRows, permissionRows] = await Promise.all([
      c.env.DB.prepare(
        `SELECT id, name, actor_type, key_prefix, status, scopes_json,
                expires_at_ms, last_used_at_ms, daily_request_limit, daily_publish_limit,
                created_at_ms, updated_at_ms
           FROM api_clients
          ORDER BY created_at_ms DESC, id ASC`
      ).all<ApiClientRow>(),
      c.env.DB.prepare(
        `SELECT cap.client_id, cap.x_account_id, cap.permission_level, cap.policy_id,
                cap.max_thread_parts, cap.allowed_hours_json, cap.created_at_ms, cap.updated_at_ms,
                xa.name AS x_account_name, xa.x_username, xa.status AS x_account_status
           FROM client_account_permissions cap
           LEFT JOIN x_accounts xa ON xa.id = cap.x_account_id
          ORDER BY cap.client_id ASC, xa.name ASC, cap.x_account_id ASC`
      ).all<ClientPermissionRow>()
    ]);

    const permissionsByClient = new Map<string, ReturnType<typeof mapPermissionRow>[]>();
    for (const row of permissionRows.results ?? []) {
      const mapped = mapPermissionRow(row);
      const existing = permissionsByClient.get(row.client_id) ?? [];
      existing.push(mapped);
      permissionsByClient.set(row.client_id, existing);
    }

    return c.json({
      availableScopes: scopes,
      apiClients: (clientRows.results ?? []).map((row) => mapClientRow(row, permissionsByClient.get(row.id) ?? []))
    });
  });

  app.post("/v1/api-clients/ai", async (c) => {
    const auth = c.get("auth");
    if (auth === null) {
      throw new Error("auth middleware missing");
    }
    assertScope(auth.client.scopes, "account:manage", auth.client.actorType);
    if (auth.client.actorType === "AI") {
      throw forbidden("AI_CLIENT_MANAGEMENT_FORBIDDEN", "AI actors cannot create API clients.");
    }

    const parsed = createExternalAiClientSchema.safeParse(await readJson(c.req.raw));
    if (!parsed.success) {
      throw badRequest("INVALID_API_CLIENT_REQUEST", "API client request is invalid.", { issues: parsed.error.issues });
    }

    const requestedScopes = [...new Set(parsed.data.scopes)];
    assertScopesAllowedForActor("AI", requestedScopes);
    const forbiddenScopes = requestedScopes.filter((scope) => externalAiForbiddenScopes.has(scope));
    if (forbiddenScopes.length > 0) {
      throw forbidden("EXTERNAL_AI_SCOPE_FORBIDDEN", "External AI clients cannot receive management, approval, reconcile, or retry scopes.", {
        scopes: forbiddenScopes
      });
    }

    const account = await c.env.DB.prepare("SELECT id FROM x_accounts WHERE id = ?").bind(parsed.data.xAccountId).first<{ id: string }>();
    if (account === null) {
      throw badRequest("X_ACCOUNT_NOT_FOUND", "X account does not exist.");
    }

    const nowMs = Date.now();
    const clientId = `client_${randomHex(8)}`;
    const keyPrefix = `xps_${randomHex(6)}`;
    const keySecret = randomHex(32);
    const apiKey = `${keyPrefix}.${keySecret}`;
    const keyDigest = await digestApiKey(c.env.API_KEY_PEPPER, apiKey);

    await c.env.DB.batch([
      c.env.DB
        .prepare(
          `INSERT INTO api_clients
           (id, name, actor_type, key_prefix, key_digest, status, scopes_json,
            expires_at_ms, last_used_at_ms, daily_request_limit, daily_publish_limit,
            created_at_ms, updated_at_ms)
           VALUES (?, ?, 'AI', ?, ?, 'ACTIVE', ?, NULL, NULL, ?, ?, ?, ?)`
        )
        .bind(
          clientId,
          parsed.data.name,
          keyPrefix,
          keyDigest,
          JSON.stringify(requestedScopes),
          parsed.data.dailyRequestLimit,
          parsed.data.dailyPublishLimit,
          nowMs,
          nowMs
        ),
      c.env.DB
        .prepare(
          `INSERT INTO client_account_permissions
           (client_id, x_account_id, permission_level, policy_id, max_thread_parts, allowed_hours_json, created_at_ms, updated_at_ms)
           VALUES (?, ?, ?, NULL, ?, NULL, ?, ?)`
        )
        .bind(clientId, parsed.data.xAccountId, parsed.data.permissionLevel, parsed.data.maxThreadParts, nowMs, nowMs),
      c.env.DB
        .prepare(
          `INSERT INTO audit_logs
           (id, event_type, actor_client_id, x_account_id, publication_id, request_id, content_hash, metadata_json, created_at_ms)
           VALUES (?, 'API_CLIENT_CREATED', ?, ?, NULL, ?, NULL, ?, ?)`
        )
        .bind(
          crypto.randomUUID(),
          auth.client.id,
          parsed.data.xAccountId,
          c.get("requestId"),
          JSON.stringify({ clientId, actorType: "AI", scopes: requestedScopes, permissionLevel: parsed.data.permissionLevel }),
          nowMs
        )
    ]);

    return c.json(
      {
        apiClient: {
          id: clientId,
          name: parsed.data.name,
          actorType: "AI",
          keyPrefix,
          status: "ACTIVE",
          scopes: requestedScopes,
          dailyRequestLimit: parsed.data.dailyRequestLimit,
          dailyPublishLimit: parsed.data.dailyPublishLimit
        },
        permission: {
          clientId,
          xAccountId: parsed.data.xAccountId,
          permissionLevel: parsed.data.permissionLevel,
          maxThreadParts: parsed.data.maxThreadParts
        },
        apiKey,
        warning: "Store apiKey now. It will not be shown again."
      },
      201
    );
  });

  app.patch("/v1/api-clients/:clientId", async (c) => {
    const auth = c.get("auth");
    if (auth === null) {
      throw new Error("auth middleware missing");
    }
    assertScope(auth.client.scopes, "account:manage", auth.client.actorType);
    if (auth.client.actorType === "AI") {
      throw forbidden("AI_CLIENT_MANAGEMENT_FORBIDDEN", "AI actors cannot manage API clients.");
    }

    const parsed = updateApiClientSchema.safeParse(await readJson(c.req.raw));
    if (!parsed.success) {
      throw badRequest("INVALID_API_CLIENT_UPDATE", "API client update request is invalid.", { issues: parsed.error.issues });
    }

    const clientId = c.req.param("clientId");
    const row = await getApiClientRow(c.env.DB, clientId);
    if (row === null) {
      throw notFound("API_CLIENT_NOT_FOUND", "API client does not exist.");
    }

    const nextScopes = parsed.data.scopes === undefined ? (JSON.parse(row.scopes_json) as Scope[]) : [...new Set(parsed.data.scopes)];
    validateScopesForActor(row.actor_type, nextScopes);
    preventSelfLockout({
      targetClientId: clientId,
      actorClientId: auth.client.id,
      nextStatus: parsed.data.status ?? row.status,
      nextScopes
    });

    const nowMs = Date.now();
    await c.env.DB.batch([
      c.env.DB
        .prepare(
          `UPDATE api_clients
              SET name = ?, status = ?, scopes_json = ?,
                  daily_request_limit = ?, daily_publish_limit = ?, updated_at_ms = ?
            WHERE id = ?`
        )
        .bind(
          parsed.data.name ?? row.name,
          parsed.data.status ?? row.status,
          JSON.stringify(nextScopes),
          parsed.data.dailyRequestLimit === undefined ? row.daily_request_limit : parsed.data.dailyRequestLimit,
          parsed.data.dailyPublishLimit === undefined ? row.daily_publish_limit : parsed.data.dailyPublishLimit,
          nowMs,
          clientId
        ),
      c.env.DB
        .prepare(
          `INSERT INTO audit_logs
           (id, event_type, actor_client_id, x_account_id, publication_id, request_id, content_hash, metadata_json, created_at_ms)
           VALUES (?, 'API_CLIENT_UPDATED', ?, NULL, NULL, ?, NULL, ?, ?)`
        )
        .bind(
          crypto.randomUUID(),
          auth.client.id,
          c.get("requestId"),
          JSON.stringify({ clientId, changedFields: Object.keys(parsed.data) }),
          nowMs
        )
    ]);

    const updated = await getApiClientRow(c.env.DB, clientId);
    return c.json({ apiClient: mapClientRow(updated ?? dbPatchFallback(row, parsed.data, nextScopes, nowMs), []) });
  });

  app.patch("/v1/api-clients/:clientId/permissions/:xAccountId", async (c) => {
    const auth = c.get("auth");
    if (auth === null) {
      throw new Error("auth middleware missing");
    }
    assertScope(auth.client.scopes, "account:manage", auth.client.actorType);
    if (auth.client.actorType === "AI") {
      throw forbidden("AI_CLIENT_MANAGEMENT_FORBIDDEN", "AI actors cannot manage API clients.");
    }

    const parsed = upsertClientPermissionSchema.safeParse(await readJson(c.req.raw));
    if (!parsed.success) {
      throw badRequest("INVALID_CLIENT_PERMISSION_UPDATE", "Client permission update request is invalid.", { issues: parsed.error.issues });
    }

    const clientId = c.req.param("clientId");
    const xAccountId = c.req.param("xAccountId");
    const [clientRow, accountRow, permissionRow] = await Promise.all([
      getApiClientRow(c.env.DB, clientId),
      c.env.DB.prepare("SELECT id FROM x_accounts WHERE id = ?").bind(xAccountId).first<{ id: string }>(),
      c.env.DB
        .prepare("SELECT max_thread_parts FROM client_account_permissions WHERE client_id = ? AND x_account_id = ?")
        .bind(clientId, xAccountId)
        .first<{ max_thread_parts: number }>()
    ]);
    if (clientRow === null) {
      throw notFound("API_CLIENT_NOT_FOUND", "API client does not exist.");
    }
    if (accountRow === null) {
      throw notFound("X_ACCOUNT_NOT_FOUND", "X account does not exist.");
    }

    const maxThreadParts = parsed.data.maxThreadParts ?? permissionRow?.max_thread_parts ?? 10;
    const nowMs = Date.now();
    await c.env.DB.batch([
      c.env.DB
        .prepare(
          `INSERT INTO client_account_permissions
           (client_id, x_account_id, permission_level, policy_id, max_thread_parts, allowed_hours_json, created_at_ms, updated_at_ms)
           VALUES (?, ?, ?, NULL, ?, NULL, ?, ?)
           ON CONFLICT(client_id, x_account_id) DO UPDATE SET
             permission_level = excluded.permission_level,
             max_thread_parts = excluded.max_thread_parts,
             updated_at_ms = excluded.updated_at_ms`
        )
        .bind(clientId, xAccountId, parsed.data.permissionLevel, maxThreadParts, nowMs, nowMs),
      c.env.DB
        .prepare(
          `INSERT INTO audit_logs
           (id, event_type, actor_client_id, x_account_id, publication_id, request_id, content_hash, metadata_json, created_at_ms)
           VALUES (?, 'CLIENT_ACCOUNT_PERMISSION_UPDATED', ?, ?, NULL, ?, NULL, ?, ?)`
        )
        .bind(
          crypto.randomUUID(),
          auth.client.id,
          xAccountId,
          c.get("requestId"),
          JSON.stringify({ clientId, permissionLevel: parsed.data.permissionLevel, maxThreadParts }),
          nowMs
        )
    ]);

    return c.json({
      permission: {
        clientId,
        xAccountId,
        permissionLevel: parsed.data.permissionLevel,
        maxThreadParts
      }
    });
  });

  return app;
}

async function getApiClientRow(db: D1Database, clientId: string): Promise<ApiClientRow | null> {
  return db
    .prepare(
      `SELECT id, name, actor_type, key_prefix, status, scopes_json,
              expires_at_ms, last_used_at_ms, daily_request_limit, daily_publish_limit,
              created_at_ms, updated_at_ms
         FROM api_clients
        WHERE id = ?`
    )
    .bind(clientId)
    .first<ApiClientRow>();
}

function validateScopesForActor(actorType: ActorType, requestedScopes: Scope[]): void {
  assertScopesAllowedForActor(actorType, requestedScopes);
  if (actorType !== "AI") {
    return;
  }
  const forbiddenScopes = requestedScopes.filter((scope) => externalAiForbiddenScopes.has(scope));
  if (forbiddenScopes.length > 0) {
    throw forbidden("EXTERNAL_AI_SCOPE_FORBIDDEN", "External AI clients cannot receive management, approval, reconcile, or retry scopes.", {
      scopes: forbiddenScopes
    });
  }
}

function preventSelfLockout(params: {
  targetClientId: string;
  actorClientId: string;
  nextStatus: ApiClientStatus;
  nextScopes: Scope[];
}): void {
  if (params.targetClientId !== params.actorClientId) {
    return;
  }
  if (params.nextStatus !== "ACTIVE" || !params.nextScopes.includes("account:manage")) {
    throw forbidden("SELF_LOCKOUT_FORBIDDEN", "You cannot remove your own management access.");
  }
}

function mapClientRow(row: ApiClientRow, permissions: ReturnType<typeof mapPermissionRow>[]): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    actorType: row.actor_type,
    keyPrefix: row.key_prefix,
    status: row.status,
    scopes: JSON.parse(row.scopes_json) as Scope[],
    expiresAtMs: row.expires_at_ms,
    lastUsedAtMs: row.last_used_at_ms,
    dailyRequestLimit: row.daily_request_limit,
    dailyPublishLimit: row.daily_publish_limit,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    permissions
  };
}

function mapPermissionRow(row: ClientPermissionRow): Record<string, unknown> {
  return {
    clientId: row.client_id,
    xAccountId: row.x_account_id,
    permissionLevel: row.permission_level,
    policyId: row.policy_id,
    maxThreadParts: row.max_thread_parts,
    allowedHours: row.allowed_hours_json === null ? null : JSON.parse(row.allowed_hours_json) as number[],
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    xAccount: {
      id: row.x_account_id,
      name: row.x_account_name,
      xUsername: row.x_username,
      status: row.x_account_status
    }
  };
}

function dbPatchFallback(row: ApiClientRow, input: z.infer<typeof updateApiClientSchema>, nextScopes: Scope[], nowMs: number): ApiClientRow {
  return {
    ...row,
    name: input.name ?? row.name,
    status: input.status ?? row.status,
    scopes_json: JSON.stringify(nextScopes),
    daily_request_limit: input.dailyRequestLimit === undefined ? row.daily_request_limit : input.dailyRequestLimit,
    daily_publish_limit: input.dailyPublishLimit === undefined ? row.daily_publish_limit : input.dailyPublishLimit,
    updated_at_ms: nowMs
  };
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw badRequest("INVALID_JSON", "Request body must be valid JSON.");
  }
}
