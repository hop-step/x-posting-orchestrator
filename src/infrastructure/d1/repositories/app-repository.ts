import { D1AuthRepository } from "./auth-repository";
import type { ApprovalRecord, PublicationBundle, PublicationPlan, PublicationRecord, PublicationStepPlan } from "../../../domain/publications/entities";
import type { AuditLogInput, IdempotencyRecord, PublicationListFilter, PublicationRepository } from "../../../application/repository";
import type { MediaAsset } from "../../../domain/media/entities";
import type { XAccount } from "../../../domain/auth/types";
import { randomHex } from "../../../shared/ids";
import type { PublishQueueMessage } from "../../../workers/messages";

interface PublicationRow {
  id: string;
  x_account_id: string;
  created_by_client_id: string;
  status: PublicationRecord["status"];
  kind: PublicationRecord["kind"];
  revision: number;
  content_hash: string;
  request_json: string;
  overflow_policy: PublicationRecord["overflowPolicy"];
  approval_preference: PublicationRecord["approvalPreference"];
  policy_id: string | null;
  policy_version: number | null;
  policy_decision: PublicationRecord["policyDecision"];
  policy_reasons_json: string;
  approval_required: number;
  active_approval_id: string | null;
  active_plan_id: string | null;
  scheduled_at_ms: number;
  next_action_at_ms: number | null;
  lease_token: string | null;
  lease_until_ms: number | null;
  root_published_at_ms: number | null;
  completed_at_ms: number | null;
  failure_code: string | null;
  failure_json: string | null;
  created_at_ms: number;
  updated_at_ms: number;
}

interface PlanRow {
  id: string;
  publication_id: string;
  kind: PublicationPlan["kind"];
  strategy: PublicationPlan["strategy"];
  plan_hash: string;
  capability_requirements_json: string;
  is_active: number;
  created_at_ms: number;
}

interface StepRow {
  id: string;
  plan_id: string;
  sequence_no: number;
  step_type: PublicationStepPlan["stepType"];
  relation_type: PublicationStepPlan["relation"];
  reply_to_step_id: string | null;
  trigger_type: PublicationStepPlan["triggerType"];
  trigger_offset_minutes: number;
  resolved_due_at_ms: number | null;
  text: string;
  poll_json: string | null;
  weighted_length: number;
  made_with_ai: number;
  status: PublicationStepPlan["status"];
  attempt_count: number;
  x_post_id: string | null;
  published_at_ms: number | null;
  next_attempt_at_ms: number | null;
  last_error_code: string | null;
  last_error_json: string | null;
  created_at_ms: number;
  updated_at_ms: number;
}

interface ApprovalRow {
  id: string;
  publication_id: string;
  revision: number;
  content_hash: string;
  decision: ApprovalRecord["decision"];
  actor_client_id: string;
  comment: string | null;
  revoked_at_ms: number | null;
  revoked_reason: string | null;
  created_at_ms: number;
}

interface IdempotencyRow {
  client_id: string;
  idempotency_key: string;
  method: string;
  path: string;
  request_hash: string;
  status: IdempotencyRecord["status"];
  response_status: number | null;
  response_body_json: string | null;
  expires_at_ms: number;
  created_at_ms: number;
  updated_at_ms: number;
}

interface MediaAssetRow {
  id: string;
  x_account_id: string;
  created_by_client_id: string;
  r2_key: string;
  original_filename: string | null;
  mime_type: MediaAsset["mimeType"];
  size_bytes: number;
  sha256: string;
  alt_text: string | null;
  ai_generated: number;
  status: MediaAsset["status"];
  expires_at_ms: number | null;
  created_at_ms: number;
  updated_at_ms: number;
}

type PublicationBundleRow = PublicationRow | PlanRow | StepRow | ApprovalRow;

const PUBLICATION_BUNDLE_QUERY_CHUNK_SIZE = 90;

export class D1AppRepository extends D1AuthRepository implements PublicationRepository {
  constructor(private readonly database: D1Database) {
    super(database);
  }

  async createPublicationBundle(bundle: PublicationBundle): Promise<void> {
    await this.database.batch([
      this.insertPublication(bundle.publication),
      ...bundle.plans.flatMap((plan) => [this.insertPlan(bundle.publication.id, plan), ...plan.steps.map((step) => this.insertStep(plan, step))]),
      ...bundle.approvals.map((approval) => this.insertApproval(approval))
    ]);
  }

  async updatePublicationBundle(bundle: PublicationBundle): Promise<void> {
    await this.database.batch([
      this.database.prepare("DELETE FROM publication_steps WHERE plan_id IN (SELECT id FROM publication_plans WHERE publication_id = ?)").bind(bundle.publication.id),
      this.database.prepare("DELETE FROM publication_plans WHERE publication_id = ?").bind(bundle.publication.id),
      this.database.prepare("DELETE FROM approvals WHERE publication_id = ?").bind(bundle.publication.id),
      this.updatePublicationStatement(bundle.publication),
      ...bundle.plans.flatMap((plan) => [this.insertPlan(bundle.publication.id, plan), ...plan.steps.map((step) => this.insertStep(plan, step))]),
      ...bundle.approvals.map((approval) => this.insertApproval(approval))
    ]);
  }

  async getPublicationBundle(id: string): Promise<PublicationBundle | null> {
    return (await this.getPublicationBundlesByIds([id])).get(id) ?? null;
  }

  async listPublicationBundlesForClient(clientId: string, limit: number, filter: PublicationListFilter = {}): Promise<PublicationBundle[]> {
    const publicationStatuses = filter.publicationStatuses ?? [];
    const stepStatuses = filter.stepStatuses ?? [];
    const filterClauses: string[] = [];
    const bindings: Array<string | number> = [clientId];
    if (publicationStatuses.length > 0) {
      filterClauses.push(`p.status IN (${publicationStatuses.map(() => "?").join(", ")})`);
      bindings.push(...publicationStatuses);
    }
    if (stepStatuses.length > 0) {
      filterClauses.push(
        `EXISTS (
           SELECT 1
           FROM publication_plans pp
           INNER JOIN publication_steps ps ON ps.plan_id = pp.id
          WHERE pp.publication_id = p.id
            AND pp.is_active = 1
            AND ps.status IN (${stepStatuses.map(() => "?").join(", ")})
         )`
      );
      bindings.push(...stepStatuses);
    }
    const filterSql = filterClauses.length > 0 ? `AND (${filterClauses.join(" OR ")})` : "";
    bindings.push(limit);
    const rows = await this.database
      .prepare(
        `SELECT p.id
         FROM publications p
         INNER JOIN client_account_permissions cap
          ON cap.x_account_id = p.x_account_id
          AND cap.client_id = ?
          AND cap.permission_level > 0
         ${filterSql}
         ORDER BY p.created_at_ms DESC
         LIMIT ?`
      )
      .bind(...bindings)
      .all<{ id: string }>();
    const publicationIds = rows.results.map((row) => row.id);
    const bundles = await this.getPublicationBundlesByIds(publicationIds);
    return publicationIds.flatMap((id) => {
      const bundle = bundles.get(id);
      return bundle === undefined ? [] : [bundle];
    });
  }

  private async getPublicationBundlesByIds(publicationIds: string[]): Promise<Map<string, PublicationBundle>> {
    const uniqueIds = Array.from(new Set(publicationIds.filter(Boolean)));
    const bundles = new Map<string, PublicationBundle>();
    for (let index = 0; index < uniqueIds.length; index += PUBLICATION_BUNDLE_QUERY_CHUNK_SIZE) {
      const chunk = uniqueIds.slice(index, index + PUBLICATION_BUNDLE_QUERY_CHUNK_SIZE);
      const placeholders = chunk.map(() => "?").join(", ");
      const [publicationResult, planResult, stepResult, approvalResult] = await this.database.batch<PublicationBundleRow>([
        this.database.prepare(`SELECT * FROM publications WHERE id IN (${placeholders})`).bind(...chunk),
        this.database.prepare(`SELECT * FROM publication_plans WHERE publication_id IN (${placeholders}) ORDER BY publication_id, kind`).bind(...chunk),
        this.database
          .prepare(
            `SELECT ps.*
               FROM publication_steps ps
               INNER JOIN publication_plans pp ON pp.id = ps.plan_id
              WHERE pp.publication_id IN (${placeholders})
              ORDER BY pp.publication_id, ps.plan_id, ps.sequence_no`
          )
          .bind(...chunk),
        this.database.prepare(`SELECT * FROM approvals WHERE publication_id IN (${placeholders}) ORDER BY publication_id, created_at_ms`).bind(...chunk)
      ]);

      const publicationRows = (publicationResult?.results ?? []).filter(isPublicationRow);
      const planRows = (planResult?.results ?? []).filter(isPlanRow);
      const stepRows = (stepResult?.results ?? []).filter(isStepRow);
      const approvalRows = (approvalResult?.results ?? []).filter(isApprovalRow);
      const stepsByPlanId = groupRows(stepRows, (row) => row.plan_id);
      const plansByPublicationId = groupRows(planRows, (row) => row.publication_id);
      const approvalsByPublicationId = groupRows(approvalRows, (row) => row.publication_id);

      for (const publicationRow of publicationRows) {
        bundles.set(publicationRow.id, {
          publication: mapPublication(publicationRow),
          plans: (plansByPublicationId.get(publicationRow.id) ?? []).map((row) => mapPlan(row, stepsByPlanId.get(row.id) ?? [])),
          approvals: (approvalsByPublicationId.get(publicationRow.id) ?? []).map(mapApproval)
        });
      }
    }
    return bundles;
  }

  async createApproval(approval: ApprovalRecord): Promise<void> {
    await this.insertApproval(approval).run();
  }

  async updatePublication(record: PublicationRecord): Promise<void> {
    await this.updatePublicationStatement(record).run();
  }

  async getIdempotencyRecord(clientId: string, key: string): Promise<IdempotencyRecord | null> {
    const row = await this.database
      .prepare("SELECT * FROM idempotency_records WHERE client_id = ? AND idempotency_key = ?")
      .bind(clientId, key)
      .first<IdempotencyRow>();
    return row === null ? null : mapIdempotency(row);
  }

  async createIdempotencyRecord(record: IdempotencyRecord): Promise<void> {
    await this.database
      .prepare(
        `INSERT INTO idempotency_records
        (client_id, idempotency_key, method, path, request_hash, status, response_status, response_body_json, expires_at_ms, created_at_ms, updated_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        record.clientId,
        record.idempotencyKey,
        record.method,
        record.path,
        record.requestHash,
        record.status,
        record.responseStatus,
        record.responseBody === null ? null : JSON.stringify(record.responseBody),
        record.expiresAtMs,
        record.createdAtMs,
        record.updatedAtMs
      )
      .run();
  }

  async completeIdempotencyRecord(
    clientId: string,
    key: string,
    responseStatus: number,
    responseBody: unknown,
    nowMs: number
  ): Promise<void> {
    await this.database
      .prepare(
        "UPDATE idempotency_records SET status = 'COMPLETED', response_status = ?, response_body_json = ?, updated_at_ms = ? WHERE client_id = ? AND idempotency_key = ?"
      )
      .bind(responseStatus, JSON.stringify(responseBody), nowMs, clientId, key)
      .run();
  }

  async failIdempotencyRecord(clientId: string, key: string, nowMs: number): Promise<void> {
    await this.database
      .prepare("UPDATE idempotency_records SET status = 'FAILED', updated_at_ms = ? WHERE client_id = ? AND idempotency_key = ?")
      .bind(nowMs, clientId, key)
      .run();
  }

  async recordAuditLog(input: AuditLogInput): Promise<void> {
    await this.database
      .prepare(
        `INSERT INTO audit_logs
        (id, event_type, actor_client_id, x_account_id, publication_id, request_id, content_hash, metadata_json, created_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        crypto.randomUUID(),
        input.eventType,
        input.actorClientId,
        input.xAccountId,
        input.publicationId,
        input.requestId,
        input.contentHash,
        JSON.stringify(input.metadata),
        input.createdAtMs
      )
      .run();
  }

  async claimDuePublications(nowMs: number, leaseDurationMs: number, limit: number): Promise<PublishQueueMessage[]> {
    const candidates = await this.database
      .prepare(
        `SELECT id, revision, content_hash, status
         FROM publications
         WHERE status IN ('SCHEDULED', 'QUEUED', 'AWAITING_FOLLOW_UP', 'RETRY_SCHEDULED')
           AND next_action_at_ms <= ?
           AND (lease_until_ms IS NULL OR lease_until_ms < ?)
         ORDER BY next_action_at_ms ASC
         LIMIT ?`
      )
      .bind(nowMs, nowMs, limit)
      .all<{ id: string; revision: number; content_hash: string; status: PublicationRecord["status"] }>();

    const messages: PublishQueueMessage[] = [];
    for (const candidate of candidates.results) {
      const leaseToken = randomHex(16);
      const result = await this.database
        .prepare(
          `UPDATE publications
           SET status = 'QUEUED', lease_token = ?, lease_until_ms = ?, updated_at_ms = ?
           WHERE id = ?
             AND revision = ?
             AND content_hash = ?
             AND status IN ('SCHEDULED', 'QUEUED', 'AWAITING_FOLLOW_UP', 'RETRY_SCHEDULED')
             AND next_action_at_ms <= ?
             AND (lease_until_ms IS NULL OR lease_until_ms < ?)`
        )
        .bind(leaseToken, nowMs + leaseDurationMs, nowMs, candidate.id, candidate.revision, candidate.content_hash, nowMs, nowMs)
        .run();
      if (result.meta.changes === 1) {
        messages.push({
          version: 1,
          publicationId: candidate.id,
          revision: candidate.revision,
          contentHash: candidate.content_hash,
          leaseToken,
          reason: queueReasonForStatus(candidate.status),
          enqueuedAtMs: nowMs
        });
      }
    }
    return messages;
  }

  async updateXAccount(account: XAccount): Promise<void> {
    await this.database
      .prepare(
        `UPDATE x_accounts SET
          name = ?, x_user_id = ?, x_username = ?, status = ?, longform_capability = ?, self_reply_capability = ?,
          access_token_ciphertext = ?, access_token_iv = ?, refresh_token_ciphertext = ?, refresh_token_iv = ?,
          token_key_version = ?, access_token_expires_at_ms = ?, scopes_json = ?, updated_at_ms = ?
        WHERE id = ?`
      )
      .bind(
        account.name,
        account.xUserId,
        account.xUsername,
        account.status,
        account.longformCapability,
        account.selfReplyCapability,
        account.accessTokenCiphertext,
        account.accessTokenIv,
        account.refreshTokenCiphertext,
        account.refreshTokenIv,
        account.tokenKeyVersion,
        account.accessTokenExpiresAtMs,
        JSON.stringify(account.scopes),
        account.updatedAtMs,
        account.id
      )
      .run();
  }

  async createMediaAsset(asset: MediaAsset): Promise<void> {
    await this.database
      .prepare(
        `INSERT INTO media_assets
        (id, x_account_id, created_by_client_id, r2_key, original_filename, mime_type, size_bytes, sha256,
         alt_text, ai_generated, status, expires_at_ms, created_at_ms, updated_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        asset.id,
        asset.xAccountId,
        asset.createdByClientId,
        asset.r2Key,
        asset.originalFilename,
        asset.mimeType,
        asset.sizeBytes,
        asset.sha256,
        asset.altText,
        asset.aiGenerated ? 1 : 0,
        asset.status,
        asset.expiresAtMs,
        asset.createdAtMs,
        asset.updatedAtMs
      )
      .run();
  }

  async getMediaAsset(id: string): Promise<MediaAsset | null> {
    const row = await this.database.prepare("SELECT * FROM media_assets WHERE id = ?").bind(id).first<MediaAssetRow>();
    return row === null ? null : mapMediaAsset(row);
  }

  private insertPublication(record: PublicationRecord): D1PreparedStatement {
    return this.database
      .prepare(
        `INSERT INTO publications
        (id, x_account_id, created_by_client_id, status, kind, revision, content_hash, request_json, overflow_policy,
         approval_preference, policy_id, policy_version, policy_decision, policy_reasons_json, approval_required,
         active_approval_id, active_plan_id, scheduled_at_ms, next_action_at_ms, lease_token, lease_until_ms,
         root_published_at_ms, completed_at_ms, failure_code, failure_json, created_at_ms, updated_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(...publicationBind(record));
  }

  private updatePublicationStatement(record: PublicationRecord): D1PreparedStatement {
    return this.database
      .prepare(
        `UPDATE publications SET
          x_account_id = ?, status = ?, kind = ?, revision = ?, content_hash = ?, request_json = ?, overflow_policy = ?,
          approval_preference = ?, policy_id = ?, policy_version = ?, policy_decision = ?, policy_reasons_json = ?,
          approval_required = ?, active_approval_id = ?, active_plan_id = ?, scheduled_at_ms = ?, next_action_at_ms = ?,
          lease_token = ?, lease_until_ms = ?, root_published_at_ms = ?, completed_at_ms = ?, failure_code = ?,
          failure_json = ?, updated_at_ms = ?
        WHERE id = ?`
      )
      .bind(
        record.xAccountId,
        record.status,
        record.kind,
        record.revision,
        record.contentHash,
        JSON.stringify(record.request),
        record.overflowPolicy,
        record.approvalPreference,
        record.policyId,
        record.policyVersion,
        record.policyDecision,
        JSON.stringify(record.policyReasons),
        record.approvalRequired ? 1 : 0,
        record.activeApprovalId,
        record.activePlanId,
        record.scheduledAtMs,
        record.nextActionAtMs,
        record.leaseToken,
        record.leaseUntilMs,
        record.rootPublishedAtMs,
        record.completedAtMs,
        record.failureCode,
        record.failure === null ? null : JSON.stringify(record.failure),
        record.updatedAtMs,
        record.id
      );
  }

  private insertPlan(publicationId: string, plan: PublicationPlan): D1PreparedStatement {
    return this.database
      .prepare(
        `INSERT INTO publication_plans
        (id, publication_id, kind, strategy, plan_hash, capability_requirements_json, is_active, created_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        plan.id,
        publicationId,
        plan.kind,
        plan.strategy,
        plan.planHash,
        JSON.stringify(plan.capabilityRequirements),
        plan.isActive ? 1 : 0,
        plan.createdAtMs
      );
  }

  private insertStep(plan: PublicationPlan, step: PublicationStepPlan): D1PreparedStatement {
    return this.database
      .prepare(
        `INSERT INTO publication_steps
        (id, plan_id, sequence_no, step_type, relation_type, reply_to_step_id, trigger_type, trigger_offset_minutes,
         resolved_due_at_ms, text, poll_json, weighted_length, made_with_ai, status, attempt_count, x_post_id,
         published_at_ms, next_attempt_at_ms, last_error_code, last_error_json, created_at_ms, updated_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        step.id,
        plan.id,
        step.sequence,
        step.stepType,
        step.relation,
        step.replyToStepId,
        step.triggerType,
        step.triggerOffsetMinutes,
        step.resolvedDueAtMs,
        step.text,
        step.poll === null ? null : JSON.stringify(step.poll),
        step.weightedLength,
        step.madeWithAi ? 1 : 0,
        step.status,
        step.attemptCount,
        step.xPostId,
        step.publishedAtMs,
        step.nextAttemptAtMs,
        step.lastErrorCode,
        step.lastError === null ? null : JSON.stringify(step.lastError),
        plan.createdAtMs,
        plan.createdAtMs
      );
  }

  private insertApproval(approval: ApprovalRecord): D1PreparedStatement {
    return this.database
      .prepare(
        `INSERT INTO approvals
        (id, publication_id, revision, content_hash, decision, actor_client_id, comment, revoked_at_ms, revoked_reason, created_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        approval.id,
        approval.publicationId,
        approval.revision,
        approval.contentHash,
        approval.decision,
        approval.actorClientId,
        approval.comment,
        approval.revokedAtMs,
        approval.revokedReason,
        approval.createdAtMs
      );
  }
}

function isPublicationRow(row: PublicationBundleRow): row is PublicationRow {
  return "request_json" in row;
}

function isPlanRow(row: PublicationBundleRow): row is PlanRow {
  return "capability_requirements_json" in row;
}

function isStepRow(row: PublicationBundleRow): row is StepRow {
  return "sequence_no" in row;
}

function isApprovalRow(row: PublicationBundleRow): row is ApprovalRow {
  return "decision" in row;
}

function groupRows<Row>(rows: Row[], keyFor: (row: Row) => string): Map<string, Row[]> {
  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    const key = keyFor(row);
    const values = grouped.get(key);
    if (values === undefined) {
      grouped.set(key, [row]);
    } else {
      values.push(row);
    }
  }
  return grouped;
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

function publicationBind(record: PublicationRecord): unknown[] {
  return [
    record.id,
    record.xAccountId,
    record.createdByClientId,
    record.status,
    record.kind,
    record.revision,
    record.contentHash,
    JSON.stringify(record.request),
    record.overflowPolicy,
    record.approvalPreference,
    record.policyId,
    record.policyVersion,
    record.policyDecision,
    JSON.stringify(record.policyReasons),
    record.approvalRequired ? 1 : 0,
    record.activeApprovalId,
    record.activePlanId,
    record.scheduledAtMs,
    record.nextActionAtMs,
    record.leaseToken,
    record.leaseUntilMs,
    record.rootPublishedAtMs,
    record.completedAtMs,
    record.failureCode,
    record.failure === null ? null : JSON.stringify(record.failure),
    record.createdAtMs,
    record.updatedAtMs
  ];
}

function mapPublication(row: PublicationRow): PublicationRecord {
  return {
    id: row.id,
    xAccountId: row.x_account_id,
    createdByClientId: row.created_by_client_id,
    status: row.status,
    kind: row.kind,
    revision: row.revision,
    contentHash: row.content_hash,
    request: JSON.parse(row.request_json) as PublicationRecord["request"],
    overflowPolicy: row.overflow_policy,
    approvalPreference: row.approval_preference,
    policyId: row.policy_id,
    policyVersion: row.policy_version,
    policyDecision: row.policy_decision,
    policyReasons: JSON.parse(row.policy_reasons_json) as string[],
    approvalRequired: row.approval_required === 1,
    activeApprovalId: row.active_approval_id,
    activePlanId: row.active_plan_id,
    scheduledAtMs: row.scheduled_at_ms,
    nextActionAtMs: row.next_action_at_ms,
    leaseToken: row.lease_token,
    leaseUntilMs: row.lease_until_ms,
    rootPublishedAtMs: row.root_published_at_ms,
    completedAtMs: row.completed_at_ms,
    failureCode: row.failure_code,
    failure: row.failure_json === null ? null : JSON.parse(row.failure_json),
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms
  };
}

function mapPlan(row: PlanRow, stepRows: StepRow[]): PublicationPlan {
  return {
    id: row.id,
    kind: row.kind,
    strategy: row.strategy,
    steps: stepRows.map(mapStep),
    capabilityRequirements: JSON.parse(row.capability_requirements_json) as PublicationPlan["capabilityRequirements"],
    planHash: row.plan_hash,
    isActive: row.is_active === 1,
    createdAtMs: row.created_at_ms
  };
}

function mapStep(row: StepRow): PublicationStepPlan {
  return {
    id: row.id,
    sequence: row.sequence_no,
    stepType: row.step_type,
    relation: row.relation_type,
    replyToStepId: row.reply_to_step_id,
    triggerType: row.trigger_type,
    triggerOffsetMinutes: row.trigger_offset_minutes,
    resolvedDueAtMs: row.resolved_due_at_ms,
    text: row.text,
    poll: row.poll_json === null ? null : (JSON.parse(row.poll_json) as PublicationStepPlan["poll"]),
    mediaIds: [],
    weightedLength: row.weighted_length,
    madeWithAi: row.made_with_ai === 1,
    status: row.status,
    attemptCount: row.attempt_count,
    xPostId: row.x_post_id,
    publishedAtMs: row.published_at_ms,
    nextAttemptAtMs: row.next_attempt_at_ms,
    lastErrorCode: row.last_error_code,
    lastError: row.last_error_json === null ? null : JSON.parse(row.last_error_json)
  };
}

function mapApproval(row: ApprovalRow): ApprovalRecord {
  return {
    id: row.id,
    publicationId: row.publication_id,
    revision: row.revision,
    contentHash: row.content_hash,
    decision: row.decision,
    actorClientId: row.actor_client_id,
    comment: row.comment,
    revokedAtMs: row.revoked_at_ms,
    revokedReason: row.revoked_reason,
    createdAtMs: row.created_at_ms
  };
}

function mapIdempotency(row: IdempotencyRow): IdempotencyRecord {
  return {
    clientId: row.client_id,
    idempotencyKey: row.idempotency_key,
    method: row.method,
    path: row.path,
    requestHash: row.request_hash,
    status: row.status,
    responseStatus: row.response_status,
    responseBody: row.response_body_json === null ? null : JSON.parse(row.response_body_json),
    expiresAtMs: row.expires_at_ms,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms
  };
}

function mapMediaAsset(row: MediaAssetRow): MediaAsset {
  return {
    id: row.id,
    xAccountId: row.x_account_id,
    createdByClientId: row.created_by_client_id,
    r2Key: row.r2_key,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    altText: row.alt_text,
    aiGenerated: row.ai_generated === 1,
    status: row.status,
    expiresAtMs: row.expires_at_ms,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms
  };
}
