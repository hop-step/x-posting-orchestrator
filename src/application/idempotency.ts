import { conflict } from "../shared/errors";
import { sha256Canonical } from "../shared/crypto";
import type { Clock } from "../shared/clock";
import type { PublicationRepository } from "./repository";

export interface IdempotentResult {
  status: number;
  body: unknown;
}

export async function runIdempotent(params: {
  repository: PublicationRepository;
  clock: Clock;
  ttlHours: number;
  clientId: string;
  key: string | null;
  method: string;
  path: string;
  requestBody: unknown;
  handler: () => Promise<IdempotentResult>;
}): Promise<IdempotentResult> {
  const { repository, clock, ttlHours, clientId, key, method, path, requestBody, handler } = params;
  if (key === null || key.trim() === "") {
    throw conflict("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required.");
  }

  const nowMs = clock.nowMs();
  const requestHash = await sha256Canonical({ method, path, requestBody });
  const existing = await repository.getIdempotencyRecord(clientId, key);
  if (existing !== null && existing.expiresAtMs > nowMs) {
    if (existing.requestHash !== requestHash) {
      throw conflict("IDEMPOTENCY_KEY_CONFLICT", "Idempotency-Key was already used with a different request.");
    }
    if (existing.status === "COMPLETED" && existing.responseStatus !== null) {
      return {
        status: existing.responseStatus,
        body: existing.responseBody
      };
    }
    throw conflict("IDEMPOTENCY_IN_PROGRESS", "Idempotent request is already in progress.");
  }

  await repository.createIdempotencyRecord({
    clientId,
    idempotencyKey: key,
    method,
    path,
    requestHash,
    status: "IN_PROGRESS",
    responseStatus: null,
    responseBody: null,
    expiresAtMs: nowMs + ttlHours * 60 * 60 * 1000,
    createdAtMs: nowMs,
    updatedAtMs: nowMs
  });

  try {
    const result = await handler();
    await repository.completeIdempotencyRecord(clientId, key, result.status, result.body, clock.nowMs());
    return result;
  } catch (error) {
    await repository.failIdempotencyRecord(clientId, key, clock.nowMs());
    throw error;
  }
}
