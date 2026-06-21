export const approvalScopes = [
  "publication:approve",
  "publication:reject",
  "publication:reconcile"
] as const;

export const scopes = [
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
] as const;

export type Scope = (typeof scopes)[number];
export type ActorType = "AI" | "HUMAN" | "SERVICE";
export type ApiClientStatus = "ACTIVE" | "DISABLED";
export type XAccountStatus = "ACTIVE" | "DISABLED" | "AUTH_ERROR";
export type LongformCapability = "UNKNOWN" | "ENABLED" | "DISABLED";
export type SelfReplyCapability = "UNVERIFIED" | "ENABLED" | "DISABLED";

export interface ApiClient {
  id: string;
  name: string;
  actorType: ActorType;
  keyPrefix: string;
  keyDigest: string;
  status: ApiClientStatus;
  scopes: Scope[];
  expiresAtMs: number | null;
  lastUsedAtMs: number | null;
  dailyRequestLimit: number | null;
  dailyPublishLimit: number | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface XAccount {
  id: string;
  name: string;
  xUserId: string | null;
  xUsername: string | null;
  status: XAccountStatus;
  longformCapability: LongformCapability;
  selfReplyCapability: SelfReplyCapability;
  accessTokenCiphertext: string | null;
  accessTokenIv: string | null;
  refreshTokenCiphertext: string | null;
  refreshTokenIv: string | null;
  tokenKeyVersion: number | null;
  accessTokenExpiresAtMs: number | null;
  scopes: string[];
  createdAtMs: number;
  updatedAtMs: number;
}

export interface ClientAccountPermission {
  clientId: string;
  xAccountId: string;
  permissionLevel: 0 | 1 | 2 | 3;
  policyId: string | null;
  maxThreadParts: number;
  allowedHours: number[] | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface AuthContext {
  client: ApiClient;
  requestId: string;
}
