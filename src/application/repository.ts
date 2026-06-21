import type { AuthRepository } from "../domain/auth/authorization";
import type { ApiClient, ClientAccountPermission, XAccount } from "../domain/auth/types";
import type { ApprovalRecord, PublicationBundle, PublicationPlan, PublicationRecord } from "../domain/publications/entities";

export interface IdempotencyRecord {
  clientId: string;
  idempotencyKey: string;
  method: string;
  path: string;
  requestHash: string;
  status: "IN_PROGRESS" | "COMPLETED" | "FAILED";
  responseStatus: number | null;
  responseBody: unknown;
  expiresAtMs: number;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface AuditLogInput {
  eventType: string;
  actorClientId: string | null;
  xAccountId: string | null;
  publicationId: string | null;
  requestId: string | null;
  contentHash: string | null;
  metadata: Record<string, unknown>;
  createdAtMs: number;
}

export interface PublicationRepository extends AuthRepository {
  createPublicationBundle(bundle: PublicationBundle): Promise<void>;
  updatePublicationBundle(bundle: PublicationBundle): Promise<void>;
  getPublicationBundle(id: string): Promise<PublicationBundle | null>;
  listPublicationBundlesForClient(clientId: string, limit: number): Promise<PublicationBundle[]>;
  createApproval(approval: ApprovalRecord): Promise<void>;
  updatePublication(record: PublicationRecord): Promise<void>;
  getIdempotencyRecord(clientId: string, key: string): Promise<IdempotencyRecord | null>;
  createIdempotencyRecord(record: IdempotencyRecord): Promise<void>;
  completeIdempotencyRecord(clientId: string, key: string, responseStatus: number, responseBody: unknown, nowMs: number): Promise<void>;
  failIdempotencyRecord(clientId: string, key: string, nowMs: number): Promise<void>;
  recordAuditLog(input: AuditLogInput): Promise<void>;
}

export interface SeedData {
  clients?: ApiClient[];
  accounts?: XAccount[];
  permissions?: ClientAccountPermission[];
  publications?: PublicationBundle[];
}

export function activeApproval(bundle: PublicationBundle): ApprovalRecord | null {
  const approvalId = bundle.publication.activeApprovalId;
  if (approvalId === null) {
    return null;
  }
  return bundle.approvals.find((approval) => approval.id === approvalId && approval.decision === "APPROVED") ?? null;
}

export function activePlan(bundle: PublicationBundle): PublicationPlan | null {
  const planId = bundle.publication.activePlanId;
  if (planId === null) {
    return null;
  }
  return bundle.plans.find((plan) => plan.id === planId) ?? null;
}
