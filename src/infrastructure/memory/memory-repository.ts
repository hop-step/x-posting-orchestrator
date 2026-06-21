import type { AuthRepository } from "../../domain/auth/authorization";
import type { ApiClient, ClientAccountPermission, XAccount } from "../../domain/auth/types";
import type { ApprovalRecord, PublicationBundle, PublicationRecord } from "../../domain/publications/entities";
import type { AuditLogInput, IdempotencyRecord, PublicationRepository, SeedData } from "../../application/repository";

export class MemoryRepository implements PublicationRepository, AuthRepository {
  readonly clients = new Map<string, ApiClient>();
  readonly clientsByPrefix = new Map<string, ApiClient>();
  readonly accounts = new Map<string, XAccount>();
  readonly permissions = new Map<string, ClientAccountPermission>();
  readonly publications = new Map<string, PublicationBundle>();
  readonly idempotency = new Map<string, IdempotencyRecord>();
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
      .filter((bundle) => bundle.publication.createdByClientId === clientId)
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
