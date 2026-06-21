import { constantTimeEqual, hmacSha256Hex } from "../../shared/crypto";
import { forbidden, unauthorized } from "../../shared/errors";
import { approvalScopes, type ActorType, type Scope } from "./types";

const approvalScopeSet: ReadonlySet<Scope> = new Set<Scope>(approvalScopes);

export interface ParsedApiKey {
  prefix: string;
  fullKey: string;
}

export function parseBearerApiKey(header: string | null): ParsedApiKey {
  if (header === null || !header.startsWith("Bearer ")) {
    throw unauthorized();
  }
  const fullKey = header.slice("Bearer ".length).trim();
  const match = /^xps_([A-Za-z0-9_-]{4,64})\.[A-Za-z0-9._~-]{24,}$/.exec(fullKey);
  if (match === null) {
    throw unauthorized("INVALID_API_KEY", "Invalid API key format.");
  }
  return {
    prefix: `xps_${match[1]}`,
    fullKey
  };
}

export async function digestApiKey(apiKeyPepper: string, fullApiKey: string): Promise<string> {
  return hmacSha256Hex(apiKeyPepper, fullApiKey);
}

export async function verifyApiKeyDigest(
  apiKeyPepper: string,
  fullApiKey: string,
  storedDigest: string
): Promise<boolean> {
  const digest = await digestApiKey(apiKeyPepper, fullApiKey);
  return constantTimeEqual(digest, storedDigest);
}

export function assertScopesAllowedForActor(actorType: ActorType, requestedScopes: Scope[]): void {
  if (actorType !== "AI") {
    return;
  }
  const forbiddenScopes = requestedScopes.filter((scope) => approvalScopeSet.has(scope));
  if (forbiddenScopes.length > 0) {
    throw forbidden("AI_APPROVAL_SCOPE_FORBIDDEN", "AI actors cannot have approval authority.", {
      scopes: forbiddenScopes
    });
  }
}

export function hasScope(scopes: Scope[], required: Scope): boolean {
  return scopes.includes(required);
}

export function assertScope(scopes: Scope[], required: Scope, actorType: ActorType): void {
  if (!hasScope(scopes, required)) {
    throw forbidden("SCOPE_DENIED", "Required scope is missing.", { required });
  }
  if (actorType === "AI" && approvalScopeSet.has(required)) {
    throw forbidden("AI_APPROVAL_FORBIDDEN", "AI actors cannot approve, reject, or reconcile.");
  }
}
