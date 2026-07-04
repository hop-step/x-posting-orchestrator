import type { AuthRepository } from "../../domain/auth/authorization";
import type { ApiClient, ClientAccountPermission, XAccount } from "../../domain/auth/types";
import type { MediaAsset } from "../../domain/media/entities";
import type { ApprovalRecord, PublicationBundle, PublicationRecord } from "../../domain/publications/entities";
import type { AuditLogInput, IdempotencyRecord, PublicationRepository, SeedData } from "../../application/repository";
import { randomHex } from "../../shared/ids";
import type { PublishQueueMessage } from "../../workers/messages";

export class MemoryRepository implements PublicationRepository, AuthRepository {
  readonly clients = new Map<string, ApiClient>();
  readonly clientsByPrefix = new Map<string, ApiClient>();
  readonly accounts = new Map<string, XAccount>();
  readonly permissions = new Map<string, ClientAccountPermission>();
  readonly publications = new Map<string, PublicationBundle>();
  readonly idempotency = new Map<string, IdempotencyRecord>();
  readonly mediaAssets = new Map<string, MediaAsset>();
  readonly auditLogs: AuditLogInput[] = [];

  constructor(seed: SeedData = {}) {
    for (const client of seed.clients ?? []) {
      this.clients.set(client.id, client);
      this.clientsByPrefix.set(client.keyPrefix, client);
    }
    for (const account of seed.accounts ?? []) {
      this.accounts.set(account.id, account);
    }
    for (const permission of seed.permissions ?? []) {
      this.permissions.set(permissionKey(permission.clientId, permission.xAccountId), permission);
    }
    for (const bundle of seed.publications ?? []) {
      this.publications.set(bundle.publication.id, clone(bundle));
    }
  }

  async getClientByKeyPrefix(prefix: string): Promise<ApiClient | null> {
    return this.clientsByPrefix.get(prefix) ?? null;
  }

  async getClientById(clientId: string): Promise<ApiClient | null> {
    return this.clients.get(clientId) ?? null;
  }

  async updateClientLastUsed(clientId: string, nowMs: number): Promise<void> {
    const client = this.clients.get(clientId);
    if (client !== undefined) {
      const updated = { ...client, lastUsedAtMs: nowMs, updatedAtMs: nowMs };
      this.clients.set(clientId, updated);
      this.clientsByPrefix.set(updated.keyPrefix, updated);
    }
  }

  async getXAccount(id: string): Promise<XAccount | null> {
    return this.accounts.get(id) ?? null;
  }

  async getClientAccountPermission(clientId: string, xAccountId: string): Promise<ClientAccountPermission | null> {
    return this.permissions.get(permissionKey(clientId, xAccountId)) ?? null;
  }

  async createPublicationBundle(bundle: PublicationBundle): Promise<void> {
    this.publications.set(bundle.publication.id, clone(bundle));
  }

  async updatePublicationBundle(bundle: PublicationBundle): Promise<void> {
    this.publications.set(bundle.publication.id, clone(bundle));
  }

  async getPublicationBundle(id: string): Promise<PublicationBundle | null> {
    const bundle = this.publications.get(id);
    return bundle === undefined ? null : clone(bundle);
  }

  async listPublicationBundlesForClient(clientId: string, limit: number): Promise<PublicationBundle[]> {
    return [...this.publications.values()]
      .filter((bundle) => {
        const permission = this.permissions.get(permissionKey(clientId, bundle.publication.xAccountId));
        return permission !== undefined && permission.permissionLevel > 0;
      })
      .sort((a, b) => b.publication.createdAtMs - a.publication.createdAtMs)
      .slice(0, limit)
      .map((bundle) => clone(bundle));
  }

  async createApproval(approval: ApprovalRecord): Promise<void> {
    const bundle = this.publications.get(approval.publicationId);
    if (bundle !== undefined) {
      bundle.approvals.push(approval);
    }
  }

  async updatePublication(record: PublicationRecord): Promise<void> {
    const bundle = this.publications.get(record.id);
    if (bundle !== undefined) {
      bundle.publication = record;
    }
  }

  async getIdempotencyRecord(clientId: string, key: string): Promise<IdempotencyRecord | null> {
    return this.idempotency.get(idempotencyKey(clientId, key)) ?? null;
  }

  async createIdempotencyRecord(record: IdempotencyRecord): Promise<void> {
    this.idempotency.set(idempotencyKey(record.clientId, record.idempotencyKey), { ...record });
  }

  async completeIdempotencyRecord(
    clientId: string,
    key: string,
    responseStatus: number,
    responseBody: unknown,
    nowMs: number
  ): Promise<void> {
    const existing = this.idempotency.get(idempotencyKey(clientId, key));
    if (existing !== undefined) {
      this.idempotency.set(idempotencyKey(clientId, key), {
        ...existing,
        status: "COMPLETED",
        responseStatus,
        responseBody,
        updatedAtMs: nowMs
      });
    }
  }

  async failIdempotencyRecord(clientId: string, key: string, nowMs: number): Promise<void> {
    const existing = this.idempotency.get(idempotencyKey(clientId, key));
    if (existing !== undefined) {
      this.idempotency.set(idempotencyKey(clientId, key), {
        ...existing,
        status: "FAILED",
        updatedAtMs: nowMs
      });
    }
  }

  async recordAuditLog(input: AuditLogInput): Promise<void> {
    this.auditLogs.push(input);
  }

  async claimDuePublications(nowMs: number, leaseDurationMs: number, limit: number): Promise<PublishQueueMessage[]> {
    const messages: PublishQueueMessage[] = [];
    const due = [...this.publications.values()]
      .filter((bundle) => {
        const publication = bundle.publication;
        return (
          ["SCHEDULED", "QUEUED", "AWAITING_FOLLOW_UP", "RETRY_SCHEDULED"].includes(publication.status) &&
          publication.nextActionAtMs !== null &&
          publication.nextActionAtMs <= nowMs &&
          (publication.leaseUntilMs === null || publication.leaseUntilMs < nowMs)
        );
      })
      .slice(0, limit);

    for (const bundle of due) {
      const leaseToken = randomHex(16);
      const reason = queueReasonForStatus(bundle.publication.status);
      bundle.publication = {
        ...bundle.publication,
        status: "QUEUED",
        leaseToken,
        leaseUntilMs: nowMs + leaseDurationMs,
        updatedAtMs: nowMs
      };
      messages.push({
        version: 1,
        publicationId: bundle.publication.id,
        revision: bundle.publication.revision,
        contentHash: bundle.publication.contentHash,
        leaseToken,
        reason,
        enqueuedAtMs: nowMs
      });
    }
    return messages;
  }

  async updateXAccount(account: XAccount): Promise<void> {
    this.accounts.set(account.id, account);
  }

  async createMediaAsset(asset: MediaAsset): Promise<void> {
    this.mediaAssets.set(asset.id, asset);
  }

  async getMediaAsset(id: string): Promise<MediaAsset | null> {
    return this.mediaAssets.get(id) ?? null;
  }
}

function queueReasonForStatus(status: PublicationRecord["status"]): PublishQueueMessage["reason"] {
  if (status === "AWAITING_FOLLOW_UP") {
    return "FOLLOW_UP";
  }
  if (status === "RETRY_SCHEDULED") {
    return "RETRY";
  }
  if (status === "QUEUED") {
    return "RECOVERY";
  }
  return "SCHEDULED";
}

function permissionKey(clientId: string, xAccountId: string): string {
  return `${clientId}:${xAccountId}`;
}

function idempotencyKey(clientId: string, key: string): string {
  return `${clientId}:${key}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
