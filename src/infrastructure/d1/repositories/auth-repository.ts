import type { AuthRepository } from "../../../domain/auth/authorization";
import type { ApiClient, ClientAccountPermission, Scope, XAccount } from "../../../domain/auth/types";

interface ApiClientRow {
  id: string;
  name: string;
  actor_type: ApiClient["actorType"];
  key_prefix: string;
  key_digest: string;
  status: ApiClient["status"];
  scopes_json: string;
  expires_at_ms: number | null;
  last_used_at_ms: number | null;
  daily_request_limit: number | null;
  daily_publish_limit: number | null;
  created_at_ms: number;
  updated_at_ms: number;
}

interface XAccountRow {
  id: string;
  name: string;
  x_user_id: string | null;
  x_username: string | null;
  status: XAccount["status"];
  longform_capability: XAccount["longformCapability"];
  self_reply_capability: XAccount["selfReplyCapability"];
  access_token_ciphertext: string | null;
  access_token_iv: string | null;
  refresh_token_ciphertext: string | null;
  refresh_token_iv: string | null;
  token_key_version: number | null;
  access_token_expires_at_ms: number | null;
  scopes_json: string | null;
  created_at_ms: number;
  updated_at_ms: number;
}

interface PermissionRow {
  client_id: string;
  x_account_id: string;
  permission_level: 0 | 1 | 2 | 3;
  policy_id: string | null;
  max_thread_parts: number;
  allowed_hours_json: string | null;
  created_at_ms: number;
  updated_at_ms: number;
}

export class D1AuthRepository implements AuthRepository {
  constructor(private readonly db: D1Database) {}

  async getClientByKeyPrefix(prefix: string): Promise<ApiClient | null> {
    const row = await this.db.prepare("SELECT * FROM api_clients WHERE key_prefix = ?").bind(prefix).first<ApiClientRow>();
    return row === null ? null : mapClient(row);
  }

  async updateClientLastUsed(clientId: string, nowMs: number): Promise<void> {
    await this.db.prepare("UPDATE api_clients SET last_used_at_ms = ?, updated_at_ms = ? WHERE id = ?").bind(nowMs, nowMs, clientId).run();
  }

  async getXAccount(id: string): Promise<XAccount | null> {
    const row = await this.db.prepare("SELECT * FROM x_accounts WHERE id = ?").bind(id).first<XAccountRow>();
    return row === null ? null : mapAccount(row);
  }

  async getClientAccountPermission(clientId: string, xAccountId: string): Promise<ClientAccountPermission | null> {
    const row = await this.db
      .prepare("SELECT * FROM client_account_permissions WHERE client_id = ? AND x_account_id = ?")
      .bind(clientId, xAccountId)
      .first<PermissionRow>();
    return row === null ? null : mapPermission(row);
  }
}

function mapClient(row: ApiClientRow): ApiClient {
  const parsedScopes = JSON.parse(row.scopes_json) as Scope[];
  return {
    id: row.id,
    name: row.name,
    actorType: row.actor_type,
    keyPrefix: row.key_prefix,
    keyDigest: row.key_digest,
    status: row.status,
    scopes: parsedScopes,
    expiresAtMs: row.expires_at_ms,
    lastUsedAtMs: row.last_used_at_ms,
    dailyRequestLimit: row.daily_request_limit,
    dailyPublishLimit: row.daily_publish_limit,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms
  };
}

function mapAccount(row: XAccountRow): XAccount {
  return {
    id: row.id,
    name: row.name,
    xUserId: row.x_user_id,
    xUsername: row.x_username,
    status: row.status,
    longformCapability: row.longform_capability,
    selfReplyCapability: row.self_reply_capability,
    accessTokenCiphertext: row.access_token_ciphertext,
    accessTokenIv: row.access_token_iv,
    refreshTokenCiphertext: row.refresh_token_ciphertext,
    refreshTokenIv: row.refresh_token_iv,
    tokenKeyVersion: row.token_key_version,
    accessTokenExpiresAtMs: row.access_token_expires_at_ms,
    scopes: row.scopes_json === null ? [] : (JSON.parse(row.scopes_json) as string[]),
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms
  };
}

function mapPermission(row: PermissionRow): ClientAccountPermission {
  return {
    clientId: row.client_id,
    xAccountId: row.x_account_id,
    permissionLevel: row.permission_level,
    policyId: row.policy_id,
    maxThreadParts: row.max_thread_parts,
    allowedHours: row.allowed_hours_json === null ? null : (JSON.parse(row.allowed_hours_json) as number[]),
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms
  };
}
