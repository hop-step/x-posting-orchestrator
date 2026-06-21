import type { AppConfig } from "../env";
import { assertScope } from "../domain/auth/api-keys";
import { authorizeAccount } from "../domain/auth/authorization";
import type { ApiClient, ClientAccountPermission, Scope, XAccount } from "../domain/auth/types";
import type { Clock } from "../shared/clock";
import { conflict, forbidden, notFound, unprocessable } from "../shared/errors";
import type { IdGenerator } from "../shared/ids";
import { contentHashForApproval } from "../domain/publications/canonical-hash";
import type {
  ApprovalRecord,
  PolicyResult,
  PreviewResult,
  PublicationBundle,
  PublicationPlan,
  PublicationRecord,
  PublicationRequest,
  PublicationStatus
} from "../domain/publications/entities";
import { buildPublicationPlans } from "../domain/publications/planner";
import { parsePublicationRequest } from "../domain/publications/schemas";
import { assertCancellable, assertEditable } from "../domain/publications/state-machine";
import { evaluatePolicy } from "../domain/policies/policy-engine";
import { runIdempotent, type IdempotentResult } from "./idempotency";
import { activeApproval, type PublicationRepository } from "./repository";

export interface PublicationServiceDeps {
  repository: PublicationRepository;
  clock: Clock;
  ids: IdGenerator;
  config: AppConfig;
}

export class PublicationService {
  constructor(private readonly deps: PublicationServiceDeps) {}

  async preview(input: unknown, client: ApiClient): Promise<PreviewResult> {
    assertScope(client.scopes, "publication:preview", client.actorType);
    const request = parsePublicationRequest(input, this.deps.clock.nowMs(), this.deps.config);
    const { account, permission } = await authorizeAccount(this.deps.repository, client, request.xAccountId, "publication:preview");
    return this.buildPreview(request, account, permission, 1);
  }

  async create(input: unknown, client: ApiClient, idempotencyKey: string | null, requestMeta: RequestMeta): Promise<IdempotentResult> {
    return runIdempotent({
      repository: this.deps.repository,
      clock: this.deps.clock,
      ttlHours: this.deps.config.idempotencyTtlHours,
      clientId: client.id,
      key: idempotencyKey,
      method: requestMeta.method,
      path: requestMeta.path,
      requestBody: input,
      handler: async () => {
        assertScope(client.scopes, "publication:create", client.actorType);
        const request = parsePublicationRequest(input, this.deps.clock.nowMs(), this.deps.config);
        const { account, permission } = await authorizeAccount(this.deps.repository, client, request.xAccountId, "publication:create");
        if (permission.permissionLevel === 0) {
          throw forbidden("PERMISSION_LEVEL_DENIED", "Level 0 clients cannot create publications.");
        }
        const preview = await this.buildPreview(request, account, permission, 1);
        if (preview.policy.decision === "DENY") {
          throw unprocessable("POLICY_DENIED", "Publication was denied by policy.", { reasons: preview.policy.reasons });
        }
        const nowMs = this.deps.clock.nowMs();
        const status = decideCreateStatus(permission.permissionLevel, preview.policy);
        const publicationId = this.deps.ids.newId("pub");
        const plans = assignPlanIds(preview.plans, this.deps.ids, nowMs);
        const activePlan = plans.find((plan) => plan.kind === "PRIMARY");
        const publication: PublicationRecord = {
          id: publicationId,
          xAccountId: request.xAccountId,
          createdByClientId: client.id,
          status,
          kind: request.kind,
          revision: 1,
          contentHash: preview.contentHash,
          request,
          overflowPolicy: request.overflowPolicy,
          approvalPreference: request.approvalPreference,
          policyId: permission.policyId,
          policyVersion: null,
          policyDecision: preview.policy.decision,
          policyReasons: preview.policy.reasons,
          approvalRequired: status === "PENDING_APPROVAL",
          activeApprovalId: null,
          activePlanId: activePlan?.id ?? null,
          scheduledAtMs: request.scheduledAtMs,
          nextActionAtMs: status === "SCHEDULED" ? request.scheduledAtMs : null,
          leaseToken: null,
          leaseUntilMs: null,
          rootPublishedAtMs: null,
          completedAtMs: null,
          failureCode: null,
          failure: null,
          createdAtMs: nowMs,
          updatedAtMs: nowMs
        };
        await this.deps.repository.createPublicationBundle({ publication, plans, approvals: [] });
        await this.audit("PUBLICATION_CREATED", client.id, publication, requestMeta.requestId, {});
        return {
          status: 201,
          body: {
            publication: toPublicationSummary(publication),
            policy: preview.policy,
            approval: {
              required: publication.approvalRequired,
              activeApprovalId: null
            }
          }
        };
      }
    });
  }

  async get(id: string, client: ApiClient): Promise<PublicationBundle> {
    const bundle = await this.deps.repository.getPublicationBundle(id);
    if (bundle === null) {
      throw notFound();
    }
    await authorizeAccount(this.deps.repository, client, bundle.publication.xAccountId, "publication:read", true);
    return bundle;
  }

  async list(client: ApiClient, limit = 50): Promise<PublicationBundle[]> {
    assertScope(client.scopes, "publication:read", client.actorType);
    return this.deps.repository.listPublicationBundlesForClient(client.id, Math.min(Math.max(limit, 1), 100));
  }

  async patch(
    id: string,
    input: unknown,
    client: ApiClient,
    idempotencyKey: string | null,
    requestMeta: RequestMeta
  ): Promise<IdempotentResult> {
    return runIdempotent({
      repository: this.deps.repository,
      clock: this.deps.clock,
      ttlHours: this.deps.config.idempotencyTtlHours,
      clientId: client.id,
      key: idempotencyKey,
      method: requestMeta.method,
      path: requestMeta.path,
      requestBody: input,
      handler: async () => {
        assertScope(client.scopes, "publication:update", client.actorType);
        const bundle = await this.getAccessible(id, client, "publication:update");
        assertEditable(bundle.publication.status);
        const nextRaw = { ...stripRequestForPatch(bundle.publication.request), ...(input as Record<string, unknown>) };
        const request = parsePublicationRequest(nextRaw, this.deps.clock.nowMs(), this.deps.config);
        const { account, permission } = await authorizeAccount(this.deps.repository, client, request.xAccountId, "publication:update");
        const nextRevision = bundle.publication.revision + 1;
        const preview = await this.buildPreview(request, account, permission, nextRevision);
        if (preview.policy.decision === "DENY") {
          throw unprocessable("POLICY_DENIED", "Publication was denied by policy.", { reasons: preview.policy.reasons });
        }
        const nowMs = this.deps.clock.nowMs();
        const status = decideCreateStatus(permission.permissionLevel, preview.policy);
        const plans = assignPlanIds(preview.plans, this.deps.ids, nowMs);
        const activePlan = plans.find((plan) => plan.kind === "PRIMARY");
        const publication: PublicationRecord = {
          ...bundle.publication,
          xAccountId: request.xAccountId,
          status,
          kind: request.kind,
          revision: nextRevision,
          contentHash: preview.contentHash,
          request,
          overflowPolicy: request.overflowPolicy,
          approvalPreference: request.approvalPreference,
          policyId: permission.policyId,
          policyDecision: preview.policy.decision,
          policyReasons: preview.policy.reasons,
          approvalRequired: status === "PENDING_APPROVAL",
          activeApprovalId: null,
          activePlanId: activePlan?.id ?? null,
          scheduledAtMs: request.scheduledAtMs,
          nextActionAtMs: status === "SCHEDULED" ? request.scheduledAtMs : null,
          updatedAtMs: nowMs
        };
        const revokedApprovals = bundle.approvals.map((approval) =>
          approval.decision === "APPROVED" && approval.revokedAtMs === null
            ? { ...approval, decision: "REVOKED" as const, revokedAtMs: nowMs, revokedReason: "PUBLICATION_UPDATED" }
            : approval
        );
        await this.deps.repository.updatePublicationBundle({ publication, plans, approvals: revokedApprovals });
        await this.audit("PUBLICATION_UPDATED", client.id, publication, requestMeta.requestId, { revision: publication.revision });
        return {
          status: 200,
          body: {
            publication: toPublicationSummary(publication),
            policy: preview.policy,
            approval: {
              required: publication.approvalRequired,
              activeApprovalId: null
            }
          }
        };
      }
    });
  }

  async submit(id: string, client: ApiClient, idempotencyKey: string | null, requestMeta: RequestMeta): Promise<IdempotentResult> {
    return this.transitionFromDraft(id, client, idempotencyKey, requestMeta);
  }

  async approve(
    id: string,
    input: { revision: number; contentHash: string; comment?: string | undefined },
    client: ApiClient,
    idempotencyKey: string | null,
    requestMeta: RequestMeta
  ): Promise<IdempotentResult> {
    return runIdempotent({
      repository: this.deps.repository,
      clock: this.deps.clock,
      ttlHours: this.deps.config.idempotencyTtlHours,
      clientId: client.id,
      key: idempotencyKey,
      method: requestMeta.method,
      path: requestMeta.path,
      requestBody: input,
      handler: async () => {
        assertScope(client.scopes, "publication:approve", client.actorType);
        if (client.actorType !== "HUMAN") {
          throw forbidden("HUMAN_APPROVER_REQUIRED", "Only human actors can approve publications.");
        }
        const bundle = await this.getAccessible(id, client, "publication:approve");
        if (bundle.publication.status !== "PENDING_APPROVAL") {
          throw conflict("PUBLICATION_NOT_PENDING_APPROVAL", "Publication is not pending approval.");
        }
        assertRevisionAndHash(bundle.publication, input.revision, input.contentHash);
        const nowMs = this.deps.clock.nowMs();
        if (bundle.publication.scheduledAtMs + this.deps.config.scheduleGraceSeconds * 1000 < nowMs) {
          throw unprocessable("SCHEDULED_AT_TOO_OLD", "scheduledAt is outside the approval grace period.");
        }
        const approval: ApprovalRecord = {
          id: this.deps.ids.newId("appr"),
          publicationId: id,
          revision: input.revision,
          contentHash: input.contentHash,
          decision: "APPROVED",
          actorClientId: client.id,
          comment: input.comment ?? null,
          revokedAtMs: null,
          revokedReason: null,
          createdAtMs: nowMs
        };
        const publication: PublicationRecord = {
          ...bundle.publication,
          status: "SCHEDULED",
          activeApprovalId: approval.id,
          approvalRequired: false,
          nextActionAtMs: Math.max(bundle.publication.scheduledAtMs, nowMs),
          updatedAtMs: nowMs
        };
        await this.deps.repository.createApproval(approval);
        await this.deps.repository.updatePublication(publication);
        await this.audit("PUBLICATION_APPROVED", client.id, publication, requestMeta.requestId, { approvalId: approval.id });
        return {
          status: 200,
          body: { publication: toPublicationSummary(publication), approval: { activeApprovalId: approval.id } }
        };
      }
    });
  }

  async reject(
    id: string,
    input: { revision: number; contentHash: string; reason?: string | undefined },
    client: ApiClient,
    idempotencyKey: string | null,
    requestMeta: RequestMeta
  ): Promise<IdempotentResult> {
    return runIdempotent({
      repository: this.deps.repository,
      clock: this.deps.clock,
      ttlHours: this.deps.config.idempotencyTtlHours,
      clientId: client.id,
      key: idempotencyKey,
      method: requestMeta.method,
      path: requestMeta.path,
      requestBody: input,
      handler: async () => {
        assertScope(client.scopes, "publication:reject", client.actorType);
        if (client.actorType !== "HUMAN") {
          throw forbidden("HUMAN_REJECTER_REQUIRED", "Only human actors can reject publications.");
        }
        const bundle = await this.getAccessible(id, client, "publication:reject");
        assertRevisionAndHash(bundle.publication, input.revision, input.contentHash);
        const nowMs = this.deps.clock.nowMs();
        const approval: ApprovalRecord = {
          id: this.deps.ids.newId("appr"),
          publicationId: id,
          revision: input.revision,
          contentHash: input.contentHash,
          decision: "REJECTED",
          actorClientId: client.id,
          comment: input.reason ?? null,
          revokedAtMs: null,
          revokedReason: null,
          createdAtMs: nowMs
        };
        const publication: PublicationRecord = { ...bundle.publication, status: "REJECTED", nextActionAtMs: null, updatedAtMs: nowMs };
        await this.deps.repository.createApproval(approval);
        await this.deps.repository.updatePublication(publication);
        await this.audit("PUBLICATION_REJECTED", client.id, publication, requestMeta.requestId, { approvalId: approval.id });
        return { status: 200, body: { publication: toPublicationSummary(publication) } };
      }
    });
  }

  async cancel(id: string, client: ApiClient, idempotencyKey: string | null, requestMeta: RequestMeta): Promise<IdempotentResult> {
    return runIdempotent({
      repository: this.deps.repository,
      clock: this.deps.clock,
      ttlHours: this.deps.config.idempotencyTtlHours,
      clientId: client.id,
      key: idempotencyKey,
      method: requestMeta.method,
      path: requestMeta.path,
      requestBody: {},
      handler: async () => {
        assertScope(client.scopes, "publication:cancel", client.actorType);
        const bundle = await this.getAccessible(id, client, "publication:cancel");
        const hasPublishedSteps = bundle.plans.some((plan) => plan.steps.some((step) => step.xPostId !== null));
        assertCancellable(bundle.publication.status, hasPublishedSteps);
        const publication: PublicationRecord = {
          ...bundle.publication,
          status: "CANCELLED",
          nextActionAtMs: null,
          updatedAtMs: this.deps.clock.nowMs()
        };
        await this.deps.repository.updatePublication(publication);
        await this.audit("PUBLICATION_CANCELLED", client.id, publication, requestMeta.requestId, {});
        return { status: 200, body: { publication: toPublicationSummary(publication) } };
      }
    });
  }

  private async transitionFromDraft(
    id: string,
    client: ApiClient,
    idempotencyKey: string | null,
    requestMeta: RequestMeta
  ): Promise<IdempotentResult> {
    return runIdempotent({
      repository: this.deps.repository,
      clock: this.deps.clock,
      ttlHours: this.deps.config.idempotencyTtlHours,
      clientId: client.id,
      key: idempotencyKey,
      method: requestMeta.method,
      path: requestMeta.path,
      requestBody: {},
      handler: async () => {
        assertScope(client.scopes, "publication:submit", client.actorType);
        if (client.actorType === "AI") {
          throw forbidden("AI_SUBMIT_FORBIDDEN", "AI actors cannot submit drafts.");
        }
        const bundle = await this.getAccessible(id, client, "publication:submit");
        if (bundle.publication.status !== "DRAFT") {
          throw conflict("PUBLICATION_NOT_DRAFT", "Only DRAFT publications can be submitted.");
        }
        const { account, permission } = await authorizeAccount(this.deps.repository, client, bundle.publication.xAccountId, "publication:submit");
        if (permission.permissionLevel < 2) {
          throw forbidden("SUBMIT_PERMISSION_LEVEL_REQUIRED", "Submit requires permission level 2 or higher.");
        }
        const preview = await this.buildPreview(bundle.publication.request, account, permission, bundle.publication.revision);
        if (preview.policy.decision === "DENY") {
          throw unprocessable("POLICY_DENIED", "Publication was denied by policy.", { reasons: preview.policy.reasons });
        }
        const status = preview.policy.decision === "ALLOW" && permission.permissionLevel === 3 ? "SCHEDULED" : "PENDING_APPROVAL";
        const publication: PublicationRecord = {
          ...bundle.publication,
          status,
          policyDecision: preview.policy.decision,
          policyReasons: preview.policy.reasons,
          approvalRequired: status === "PENDING_APPROVAL",
          nextActionAtMs: status === "SCHEDULED" ? bundle.publication.scheduledAtMs : null,
          updatedAtMs: this.deps.clock.nowMs()
        };
        await this.deps.repository.updatePublication(publication);
        return { status: 200, body: { publication: toPublicationSummary(publication), policy: preview.policy } };
      }
    });
  }

  private async buildPreview(
    request: PublicationRequest,
    account: XAccount,
    permission: ClientAccountPermission,
    revision: number
  ): Promise<PreviewResult> {
    const plans = await buildPublicationPlans({
      request,
      account,
      nowMs: this.deps.clock.nowMs(),
      config: this.deps.config
    });
    const policy = evaluatePolicy({
      request,
      plans,
      permission,
      account,
      nowMs: this.deps.clock.nowMs()
    });
    return {
      normalized: {
        scheduledAtUtc: new Date(request.scheduledAtMs).toISOString(),
        kind: request.kind
      },
      plans,
      policy,
      capabilities: {
        longform: account.longformCapability,
        selfReply: account.selfReplyCapability
      },
      estimate: {
        postCreateRequests: plans[0]?.steps.length ?? 0,
        mediaUploads: request.content.mediaIds.length,
        threadParts: plans[0]?.steps.filter((step) => step.stepType === "MAIN").length ?? 0
      },
      warnings: [],
      contentHash: await contentHashForApproval({
        xAccountId: request.xAccountId,
        scheduledAtMs: request.scheduledAtMs,
        request,
        revision,
        plans
      })
    };
  }

  private async getAccessible(id: string, client: ApiClient, scope: Scope): Promise<PublicationBundle> {
    const bundle = await this.deps.repository.getPublicationBundle(id);
    if (bundle === null) {
      throw notFound();
    }
    await authorizeAccount(this.deps.repository, client, bundle.publication.xAccountId, scope, true);
    return bundle;
  }

  private async audit(
    eventType: string,
    actorClientId: string,
    publication: PublicationRecord,
    requestId: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    await this.deps.repository.recordAuditLog({
      eventType,
      actorClientId,
      xAccountId: publication.xAccountId,
      publicationId: publication.id,
      requestId,
      contentHash: publication.contentHash,
      metadata,
      createdAtMs: this.deps.clock.nowMs()
    });
  }
}

export interface RequestMeta {
  method: string;
  path: string;
  requestId: string;
}

function decideCreateStatus(permissionLevel: 0 | 1 | 2 | 3, policy: PolicyResult): PublicationStatus {
  if (permissionLevel === 1) {
    return "DRAFT";
  }
  if (permissionLevel === 2) {
    return "PENDING_APPROVAL";
  }
  return policy.decision === "ALLOW" ? "SCHEDULED" : "PENDING_APPROVAL";
}

function assignPlanIds(plans: PublicationPlan[], ids: IdGenerator, nowMs: number): PublicationPlan[] {
  return plans.map((plan) => ({
    ...plan,
    id: ids.newId("plan"),
    createdAtMs: nowMs,
    steps: plan.steps.map((step) => ({
      ...step,
      id: ids.newId("step")
    }))
  }));
}

function toPublicationSummary(publication: PublicationRecord): Record<string, unknown> {
  return {
    id: publication.id,
    revision: publication.revision,
    status: publication.status,
    xAccountId: publication.xAccountId,
    scheduledAtUtc: new Date(publication.scheduledAtMs).toISOString(),
    contentHash: publication.contentHash
  };
}

function assertRevisionAndHash(publication: PublicationRecord, revision: number, contentHash: string): void {
  if (publication.revision !== revision || publication.contentHash !== contentHash) {
    throw conflict("REVISION_OR_HASH_MISMATCH", "revision and contentHash must match the current publication.");
  }
}

function stripRequestForPatch(request: PublicationRequest): Record<string, unknown> {
  return {
    xAccountId: request.xAccountId,
    scheduledAt: request.scheduledAt,
    kind: request.kind,
    content: request.content,
    overflowPolicy: request.overflowPolicy,
    threadOptions: request.threadOptions,
    followUps: request.followUps,
    approvalPreference: request.approvalPreference
  };
}

export function hasValidApproval(bundle: PublicationBundle): boolean {
  const approval = activeApproval(bundle);
  return (
    approval !== null &&
    approval.revision === bundle.publication.revision &&
    approval.contentHash === bundle.publication.contentHash &&
    approval.revokedAtMs === null
  );
}
