import { forbidden, notFound } from "../../shared/errors";
import type { ApiClient, ClientAccountPermission, Scope, XAccount } from "./types";
import { assertScope } from "./api-keys";

export interface AccountAuthorization {
  account: XAccount;
  permission: ClientAccountPermission;
}

export interface AuthRepository {
  getClientByKeyPrefix(prefix: string): Promise<ApiClient | null>;
  updateClientLastUsed(clientId: string, nowMs: number): Promise<void>;
  getXAccount(id: string): Promise<XAccount | null>;
  getClientAccountPermission(clientId: string, xAccountId: string): Promise<ClientAccountPermission | null>;
}

export function assertAuthenticatedClientActive(client: ApiClient, nowMs: number): void {
  if (client.status !== "ACTIVE") {
    throw forbidden("API_CLIENT_DISABLED", "API client is disabled.");
  }
  if (client.expiresAtMs !== null && client.expiresAtMs <= nowMs) {
    throw forbidden("API_CLIENT_EXPIRED", "API client is expired.");
  }
}

export async function authorizeAccount(
  repository: AuthRepository,
  client: ApiClient,
  xAccountId: string,
  requiredScope: Scope,
  hideUnauthorized = false
): Promise<AccountAuthorization> {
  assertScope(client.scopes, requiredScope, client.actorType);
  const [account, permission] = await Promise.all([
    repository.getXAccount(xAccountId),
    repository.getClientAccountPermission(client.id, xAccountId)
  ]);

  if (account === null || permission === null) {
    if (hideUnauthorized) {
      throw notFound();
    }
    throw forbidden("X_ACCOUNT_DENIED", "X account is not allowed for this client.");
  }
  if (account.status !== "ACTIVE") {
    throw forbidden("X_ACCOUNT_INACTIVE", "X account is not active.");
  }
  if (permission.permissionLevel === 0 && requiredScope !== "account:read") {
    throw forbidden("PERMISSION_LEVEL_DENIED", "This client cannot create publications for the account.");
  }
  return { account, permission };
}
