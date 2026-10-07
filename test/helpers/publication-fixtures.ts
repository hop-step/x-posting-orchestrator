import type { AppConfig } from "../../src/env";
import type { ApiClient, ClientAccountPermission, Scope, XAccount } from "../../src/domain/auth/types";
import { PublicationService } from "../../src/application/publication-service";
import { MemoryRepository } from "../../src/infrastructure/memory/memory-repository";
import { FixedClock } from "../../src/shared/clock";
import { SequenceIdGenerator } from "../../src/shared/ids";

export const nowMs = Date.parse("2026-06-21T00:00:00.000Z");
export const scheduledAt = "2026-06-22T12:00:00+09:00";

export const testConfig: AppConfig = {
  scheduleGraceSeconds: 120,
  leaseDurationSeconds: 120,
  defaultMaxThreadParts: 10,
  absoluteMaxThreadParts: 25,
  maxFollowUps: 3,
  maxImageBytes: 5_242_880,
  maxImageCount: 4,
  idempotencyTtlHours: 24,
  oauthStateTtlMinutes: 10,
  tokenRefreshMarginMinutes: 10,
  maxDeliveryAttempts: 5,
  deliveryUnknownMaxAttempts: 2,
  deliveryUnknownRetryDelaySeconds: 60,
  deliveryUnknownVerificationWindowSeconds: 600,
  duplicateContentWindowHours: 24
};

export const allScopes: Scope[] = [
  "publication:preview",
  "publication:create",
  "publication:submit",
  "publication:read",
  "publication:update",
  "publication:cancel",
  "publication:approve",
  "publication:reject",
  "publication:retry",
  "publication:reconcile",
  "media:create",
  "account:read",
  "account:manage"
];

export function client(id: string, actorType: ApiClient["actorType"], scopes: Scope[] = allScopes): ApiClient {
  return {
    id,
    name: id,
    actorType,
    keyPrefix: `xps_${id}`,
    keyDigest: "digest",
    status: "ACTIVE",
    scopes,
    expiresAtMs: null,
    lastUsedAtMs: null,
    dailyRequestLimit: null,
    dailyPublishLimit: null,
    createdAtMs: nowMs,
    updatedAtMs: nowMs
  };
}

export function account(overrides: Partial<XAccount> = {}): XAccount {
  return {
    id: "acc_1",
    name: "test account",
    xUserId: "100",
    xUsername: "test",
    status: "ACTIVE",
    longformCapability: "ENABLED",
    selfReplyCapability: "ENABLED",
    accessTokenCiphertext: null,
    accessTokenIv: null,
    refreshTokenCiphertext: null,
    refreshTokenIv: null,
    tokenKeyVersion: null,
    accessTokenExpiresAtMs: null,
    scopes: [],
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    ...overrides
  };
}

export function permission(clientId: string, level: 0 | 1 | 2 | 3, xAccountId = "acc_1"): ClientAccountPermission {
  return {
    clientId,
    xAccountId,
    permissionLevel: level,
    policyId: null,
    maxThreadParts: 10,
    allowedHours: null,
    createdAtMs: nowMs,
    updatedAtMs: nowMs
  };
}

export function makeService(seed: {
  clients: ApiClient[];
  permissions: ClientAccountPermission[];
  accounts?: XAccount[];
}): { service: PublicationService; repository: MemoryRepository; clock: FixedClock } {
  const clock = new FixedClock(nowMs);
  const repository = new MemoryRepository({
    clients: seed.clients,
    accounts: seed.accounts ?? [account()],
    permissions: seed.permissions
  });
  return {
    service: new PublicationService({
      repository,
      clock,
      ids: new SequenceIdGenerator(),
      config: testConfig
    }),
    repository,
    clock
  };
}

export function baseRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    xAccountId: "acc_1",
    scheduledAt,
    kind: "TEXT",
    content: {
      text: "安全な投稿です"
    },
    overflowPolicy: "REJECT",
    approvalPreference: "POLICY",
    ...overrides
  };
}

export function requestMeta(path = "/v1/publications"): { method: string; path: string; requestId: string } {
  return {
    method: "POST",
    path,
    requestId: "req_test"
  };
}
