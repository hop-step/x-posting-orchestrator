import { index, integer, primaryKey, sqliteTable, text, unique, uniqueIndex } from "drizzle-orm/sqlite-core";

export const xAccounts = sqliteTable("x_accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  xUserId: text("x_user_id").unique(),
  xUsername: text("x_username"),
  status: text("status").notNull(),
  longformCapability: text("longform_capability").notNull().default("UNKNOWN"),
  selfReplyCapability: text("self_reply_capability").notNull().default("UNVERIFIED"),
  accessTokenCiphertext: text("access_token_ciphertext"),
  accessTokenIv: text("access_token_iv"),
  refreshTokenCiphertext: text("refresh_token_ciphertext"),
  refreshTokenIv: text("refresh_token_iv"),
  tokenKeyVersion: integer("token_key_version"),
  accessTokenExpiresAtMs: integer("access_token_expires_at_ms"),
  scopesJson: text("scopes_json"),
  createdAtMs: integer("created_at_ms").notNull(),
  updatedAtMs: integer("updated_at_ms").notNull()
});

export const apiClients = sqliteTable("api_clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  actorType: text("actor_type").notNull(),
  keyPrefix: text("key_prefix").notNull().unique(),
  keyDigest: text("key_digest").notNull(),
  status: text("status").notNull(),
  scopesJson: text("scopes_json").notNull(),
  expiresAtMs: integer("expires_at_ms"),
  lastUsedAtMs: integer("last_used_at_ms"),
  dailyRequestLimit: integer("daily_request_limit"),
  dailyPublishLimit: integer("daily_publish_limit"),
  createdAtMs: integer("created_at_ms").notNull(),
  updatedAtMs: integer("updated_at_ms").notNull()
});

export const clientAccountPermissions = sqliteTable(
  "client_account_permissions",
  {
    clientId: text("client_id").notNull(),
    xAccountId: text("x_account_id").notNull(),
    permissionLevel: integer("permission_level").notNull(),
    policyId: text("policy_id"),
    maxThreadParts: integer("max_thread_parts").notNull().default(10),
    allowedHoursJson: text("allowed_hours_json"),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.clientId, table.xAccountId] })
  })
);

export const publicationPolicies = sqliteTable(
  "publication_policies",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    version: integer("version").notNull(),
    rulesJson: text("rules_json").notNull(),
    isActive: integer("is_active").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull()
  },
  (table) => ({
    uniquePolicyVersion: unique().on(table.id, table.version)
  })
);

export const publications = sqliteTable(
  "publications",
  {
    id: text("id").primaryKey(),
    xAccountId: text("x_account_id").notNull(),
    createdByClientId: text("created_by_client_id").notNull(),
    status: text("status").notNull(),
    kind: text("kind").notNull(),
    revision: integer("revision").notNull(),
    contentHash: text("content_hash").notNull(),
    requestJson: text("request_json").notNull(),
    overflowPolicy: text("overflow_policy").notNull(),
    approvalPreference: text("approval_preference").notNull(),
    policyId: text("policy_id"),
    policyVersion: integer("policy_version"),
    policyDecision: text("policy_decision").notNull(),
    policyReasonsJson: text("policy_reasons_json").notNull(),
    approvalRequired: integer("approval_required").notNull(),
    activeApprovalId: text("active_approval_id"),
    activePlanId: text("active_plan_id"),
    scheduledAtMs: integer("scheduled_at_ms").notNull(),
    nextActionAtMs: integer("next_action_at_ms"),
    leaseToken: text("lease_token"),
    leaseUntilMs: integer("lease_until_ms"),
    rootPublishedAtMs: integer("root_published_at_ms"),
    completedAtMs: integer("completed_at_ms"),
    failureCode: text("failure_code"),
    failureJson: text("failure_json"),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull()
  },
  (table) => ({
    dueIdx: index("idx_publications_due").on(table.status, table.nextActionAtMs),
    accountCreatedIdx: index("idx_publications_account_created").on(table.xAccountId, table.createdAtMs),
    creatorCreatedIdx: index("idx_publications_creator_created").on(table.createdByClientId, table.createdAtMs)
  })
);

export const publicationPlans = sqliteTable(
  "publication_plans",
  {
    id: text("id").primaryKey(),
    publicationId: text("publication_id").notNull(),
    kind: text("kind").notNull(),
    strategy: text("strategy").notNull(),
    planHash: text("plan_hash").notNull(),
    capabilityRequirementsJson: text("capability_requirements_json").notNull(),
    isActive: integer("is_active").notNull().default(0),
    createdAtMs: integer("created_at_ms").notNull()
  },
  (table) => ({
    uniquePublicationKind: unique().on(table.publicationId, table.kind)
  })
);

export const publicationSteps = sqliteTable(
  "publication_steps",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id").notNull(),
    sequenceNo: integer("sequence_no").notNull(),
    stepType: text("step_type").notNull(),
    relationType: text("relation_type").notNull(),
    replyToStepId: text("reply_to_step_id"),
    triggerType: text("trigger_type").notNull(),
    triggerOffsetMinutes: integer("trigger_offset_minutes").notNull().default(0),
    resolvedDueAtMs: integer("resolved_due_at_ms"),
    text: text("text").notNull(),
    pollJson: text("poll_json"),
    weightedLength: integer("weighted_length").notNull(),
    madeWithAi: integer("made_with_ai").notNull().default(0),
    status: text("status").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    xPostId: text("x_post_id").unique(),
    publishedAtMs: integer("published_at_ms"),
    nextAttemptAtMs: integer("next_attempt_at_ms"),
    lastErrorCode: text("last_error_code"),
    lastErrorJson: text("last_error_json"),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull()
  },
  (table) => ({
    uniquePlanSequence: unique().on(table.planId, table.sequenceNo)
  })
);

export const mediaAssets = sqliteTable("media_assets", {
  id: text("id").primaryKey(),
  xAccountId: text("x_account_id").notNull(),
  createdByClientId: text("created_by_client_id").notNull(),
  r2Key: text("r2_key").notNull().unique(),
  originalFilename: text("original_filename"),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  altText: text("alt_text"),
  aiGenerated: integer("ai_generated").notNull().default(0),
  status: text("status").notNull(),
  expiresAtMs: integer("expires_at_ms"),
  createdAtMs: integer("created_at_ms").notNull(),
  updatedAtMs: integer("updated_at_ms").notNull()
});

export const publicationStepMedia = sqliteTable(
  "publication_step_media",
  {
    stepId: text("step_id").notNull(),
    mediaAssetId: text("media_asset_id").notNull(),
    position: integer("position").notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.stepId, table.mediaAssetId] }),
    uniqueStepPosition: unique().on(table.stepId, table.position)
  })
);

export const approvals = sqliteTable("approvals", {
  id: text("id").primaryKey(),
  publicationId: text("publication_id").notNull(),
  revision: integer("revision").notNull(),
  contentHash: text("content_hash").notNull(),
  decision: text("decision").notNull(),
  actorClientId: text("actor_client_id").notNull(),
  comment: text("comment"),
  revokedAtMs: integer("revoked_at_ms"),
  revokedReason: text("revoked_reason"),
  createdAtMs: integer("created_at_ms").notNull()
});

export const idempotencyRecords = sqliteTable(
  "idempotency_records",
  {
    clientId: text("client_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    method: text("method").notNull(),
    path: text("path").notNull(),
    requestHash: text("request_hash").notNull(),
    status: text("status").notNull(),
    responseStatus: integer("response_status"),
    responseBodyJson: text("response_body_json"),
    expiresAtMs: integer("expires_at_ms").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.clientId, table.idempotencyKey] })
  })
);

export const deliveryAttempts = sqliteTable(
  "delivery_attempts",
  {
    id: text("id").primaryKey(),
    publicationId: text("publication_id").notNull(),
    stepId: text("step_id").notNull(),
    attemptNo: integer("attempt_no").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    outcome: text("outcome").notNull(),
    httpStatus: integer("http_status"),
    xRequestId: text("x_request_id"),
    retryAtMs: integer("retry_at_ms"),
    errorCode: text("error_code"),
    errorJson: text("error_json"),
    startedAtMs: integer("started_at_ms").notNull(),
    completedAtMs: integer("completed_at_ms")
  },
  (table) => ({
    uniqueStepAttempt: unique().on(table.stepId, table.attemptNo)
  })
);

export const oauthStates = sqliteTable("oauth_states", {
  id: text("id").primaryKey(),
  stateDigest: text("state_digest").notNull().unique(),
  xAccountId: text("x_account_id").notNull(),
  codeVerifierCiphertext: text("code_verifier_ciphertext").notNull(),
  codeVerifierIv: text("code_verifier_iv").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  expiresAtMs: integer("expires_at_ms").notNull(),
  consumedAtMs: integer("consumed_at_ms"),
  createdAtMs: integer("created_at_ms").notNull()
});

export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  actorClientId: text("actor_client_id"),
  xAccountId: text("x_account_id"),
  publicationId: text("publication_id"),
  requestId: text("request_id"),
  contentHash: text("content_hash"),
  metadataJson: text("metadata_json").notNull(),
  createdAtMs: integer("created_at_ms").notNull()
});

export const uniquePublicationStepMediaPosition = uniqueIndex("publication_step_media_position").on(
  publicationStepMedia.stepId,
  publicationStepMedia.position
);
