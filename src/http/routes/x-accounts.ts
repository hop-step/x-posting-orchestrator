import { Hono } from "hono";
import { z } from "zod";
import { assertScope } from "../../domain/auth/api-keys";
import { D1AppRepository } from "../../infrastructure/d1/repositories/app-repository";
import { encryptToken, decryptToken } from "../../infrastructure/crypto/token-crypto";
import { hmacSha256Hex } from "../../shared/crypto";
import { badRequest, unprocessable } from "../../shared/errors";
import { randomHex } from "../../shared/ids";
import type { AppBindings } from "../context";

const createAccountSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  xUserId: z.string().min(1).optional(),
  xUsername: z.string().min(1).optional()
});

export function xAccountRoutes(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.post("/v1/x/accounts", async (c) => {
    const auth = c.get("auth");
    if (auth === null) {
      throw new Error("auth middleware missing");
    }
    assertScope(auth.client.scopes, "account:manage", auth.client.actorType);
    const parsed = createAccountSchema.safeParse(await readJson(c.req.raw));
    if (!parsed.success) {
      throw badRequest("INVALID_X_ACCOUNT_REQUEST", "X account request is invalid.", { issues: parsed.error.issues });
    }
    const nowMs = Date.now();
    const id = parsed.data.id ?? `acc_${randomHex(8)}`;
    await c.env.DB.prepare(
      `INSERT INTO x_accounts
       (id, name, x_user_id, x_username, status, longform_capability, self_reply_capability, scopes_json, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?, 'AUTH_ERROR', 'UNKNOWN', 'UNVERIFIED', '[]', ?, ?)`
    )
      .bind(id, parsed.data.name, parsed.data.xUserId ?? null, parsed.data.xUsername ?? null, nowMs, nowMs)
      .run();
    await c.env.DB.prepare(
      `INSERT INTO audit_logs
       (id, event_type, actor_client_id, x_account_id, publication_id, request_id, content_hash, metadata_json, created_at_ms)
       VALUES (?, 'X_ACCOUNT_CONNECTED', ?, ?, NULL, ?, NULL, '{}', ?)`
    )
      .bind(crypto.randomUUID(), auth.client.id, id, c.get("requestId"), nowMs)
      .run();
    return c.json({ account: { id, name: parsed.data.name, status: "AUTH_ERROR" } }, 201);
  });

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
    const repository = new D1AppRepository(c.env.DB);
    const account = await repository.getXAccount(c.req.param("id"));
    if (account === null) {
      return c.notFound();
    }
    return c.json({ account });
  });

  app.get("/v1/x/oauth/authorize", async (c) => {
    const auth = c.get("auth");
    if (auth === null) {
      throw new Error("auth middleware missing");
    }
    assertScope(auth.client.scopes, "account:manage", auth.client.actorType);
    const xAccountId = c.req.query("xAccountId");
    if (xAccountId === undefined) {
      throw badRequest("X_ACCOUNT_ID_REQUIRED", "xAccountId is required.");
    }
    const repository = new D1AppRepository(c.env.DB);
    const account = await repository.getXAccount(xAccountId);
    if (account === null) {
      throw badRequest("X_ACCOUNT_NOT_FOUND", "X account does not exist.");
    }
    const clientId = c.env.X_CLIENT_ID;
    const secret = c.env.TOKEN_ENCRYPTION_KEY_V1;
    if (clientId === undefined || secret === undefined) {
      throw unprocessable("OAUTH_NOT_CONFIGURED", "X OAuth client and token encryption secret must be configured.");
    }
    const redirectUri = `${c.env.PUBLIC_BASE_URL}/v1/x/oauth/callback`;
    const state = randomHex(32);
    const codeVerifier = base64UrlBytes(crypto.getRandomValues(new Uint8Array(32)));
    const codeChallenge = await pkceChallenge(codeVerifier);
    const encryptedVerifier = await encryptToken(codeVerifier, secret);
    const nowMs = Date.now();
    await c.env.DB.prepare(
      `INSERT INTO oauth_states
       (id, state_digest, x_account_id, code_verifier_ciphertext, code_verifier_iv, redirect_uri, expires_at_ms, consumed_at_ms, created_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`
    )
      .bind(
        `oauth_${randomHex(8)}`,
        await hmacSha256Hex(c.env.API_KEY_PEPPER, state),
        xAccountId,
        encryptedVerifier.ciphertext,
        encryptedVerifier.iv,
        redirectUri,
        nowMs + 10 * 60 * 1000,
        nowMs
      )
      .run();
    const authorizeUrl = new URL("https://x.com/i/oauth2/authorize");
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("scope", "tweet.read tweet.write users.read offline.access media.write");
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("code_challenge", codeChallenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    return c.redirect(authorizeUrl.toString(), 302);
  });

  return app;
}

export function xOAuthCallbackRoutes(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.get("/v1/x/oauth/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (code === undefined || state === undefined) {
      throw badRequest("OAUTH_CALLBACK_INVALID", "code and state are required.");
    }
    const secret = c.env.TOKEN_ENCRYPTION_KEY_V1;
    const clientId = c.env.X_CLIENT_ID;
    const clientSecret = c.env.X_CLIENT_SECRET;
    if (secret === undefined || clientId === undefined || clientSecret === undefined) {
      throw unprocessable("OAUTH_NOT_CONFIGURED", "X OAuth secrets are not configured.");
    }
    const stateDigest = await hmacSha256Hex(c.env.API_KEY_PEPPER, state);
    const row = await c.env.DB.prepare(
      "SELECT * FROM oauth_states WHERE state_digest = ? AND consumed_at_ms IS NULL AND expires_at_ms > ?"
    )
      .bind(stateDigest, Date.now())
      .first<{
        id: string;
        x_account_id: string;
        code_verifier_ciphertext: string;
        code_verifier_iv: string;
        redirect_uri: string;
      }>();
    if (row === null) {
      throw badRequest("OAUTH_STATE_INVALID", "OAuth state is invalid or expired.");
    }
    const codeVerifier = await decryptToken({ ciphertext: row.code_verifier_ciphertext, iv: row.code_verifier_iv }, secret);
    const tokenResponse = await fetch("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`
      },
      body: new URLSearchParams({
        code,
        grant_type: "authorization_code",
        client_id: clientId,
        redirect_uri: row.redirect_uri,
        code_verifier: codeVerifier
      })
    });
    if (!tokenResponse.ok) {
      throw unprocessable("OAUTH_TOKEN_EXCHANGE_FAILED", "X OAuth token exchange failed.");
    }
    const tokens: {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    } = await tokenResponse.json();
    if (tokens.access_token === undefined || tokens.refresh_token === undefined) {
      throw unprocessable("OAUTH_TOKEN_RESPONSE_INVALID", "X OAuth token response did not include required tokens.");
    }
    const access = await encryptToken(tokens.access_token, secret);
    const refresh = await encryptToken(tokens.refresh_token, secret);
    const nowMs = Date.now();
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE x_accounts SET status = 'ACTIVE', access_token_ciphertext = ?, access_token_iv = ?,
         refresh_token_ciphertext = ?, refresh_token_iv = ?, token_key_version = 1,
         access_token_expires_at_ms = ?, scopes_json = ?, updated_at_ms = ? WHERE id = ?`
      ).bind(
        access.ciphertext,
        access.iv,
        refresh.ciphertext,
        refresh.iv,
        nowMs + (tokens.expires_in ?? 7200) * 1000,
        JSON.stringify(tokens.scope?.split(" ") ?? []),
        nowMs,
        row.x_account_id
      ),
      c.env.DB.prepare("UPDATE oauth_states SET consumed_at_ms = ? WHERE id = ?").bind(nowMs, row.id),
      c.env.DB.prepare(
        `INSERT INTO audit_logs
         (id, event_type, actor_client_id, x_account_id, publication_id, request_id, content_hash, metadata_json, created_at_ms)
         VALUES (?, 'X_ACCOUNT_CONNECTED', NULL, ?, NULL, ?, NULL, '{}', ?)`
      ).bind(crypto.randomUUID(), row.x_account_id, c.get("requestId"), nowMs)
    ]);
    return c.json({ ok: true, xAccountId: row.x_account_id });
  });

  return app;
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw badRequest("INVALID_JSON", "Request body must be valid JSON.");
  }
}

async function pkceChallenge(verifier: string): Promise<string> {
  return base64UrlBytes(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

function base64UrlBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}
