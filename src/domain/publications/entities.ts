import type { LongformCapability, SelfReplyCapability } from "../auth/types";

export type PublicationKind = "TEXT" | "IMAGE" | "POLL";
export type OverflowPolicy = "REJECT" | "THREAD" | "LONGFORM_THEN_THREAD";
export type ApprovalPreference = "POLICY" | "REQUIRE_APPROVAL";
export type PlanKind = "PRIMARY" | "FALLBACK";
export type PlanStrategy = "STANDARD_SINGLE" | "LONGFORM_SINGLE" | "THREAD";
export type PublicationStatus =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "SCHEDULED"
  | "QUEUED"
  | "PUBLISHING"
  | "AWAITING_FOLLOW_UP"
  | "PUBLISHED"
  | "PARTIALLY_PUBLISHED"
  | "RETRY_SCHEDULED"
  | "FAILED"
  | "DELIVERY_UNKNOWN"
  | "BLOCKED_POLICY"
  | "REJECTED"
  | "CANCELLED";
export type StepStatus =
  | "PENDING"
  | "READY"
  | "UPLOADING_MEDIA"
  | "PUBLISHING"
  | "PUBLISHED"
  | "RETRY_SCHEDULED"
  | "FAILED"
  | "DELIVERY_UNKNOWN"
  | "SKIPPED";
export type StepType = "MAIN" | "FOLLOW_UP";
export type RelationType = "ROOT" | "REPLY_PREVIOUS" | "REPLY_STEP";
export type TriggerType = "AT_PUBLICATION_TIME" | "AFTER_PARENT_PUBLISHED" | "AFTER_POLL_CLOSE";
export type PolicyDecision = "DENY" | "REQUIRE_APPROVAL" | "ALLOW";

export interface PollContent {
  options: string[];
  durationMinutes: number;
}

export interface PublicationContent {
  text: string;
  mediaIds: string[];
  poll: PollContent | null;
  madeWithAi: boolean;
}

export interface ThreadOptions {
  numbering: boolean;
  maxParts: number;
  mediaPlacement: "FIRST";
}

export interface FollowUpRequest {
  trigger: {
    type: Exclude<TriggerType, "AT_PUBLICATION_TIME">;
    offsetMinutes: number;
  };
  content: {
    text: string;
  };
}

export interface PublicationRequest {
  xAccountId: string;
  scheduledAt: string;
  scheduledAtMs: number;
  kind: PublicationKind;
  content: PublicationContent;
  overflowPolicy: OverflowPolicy;
  threadOptions: ThreadOptions;
  followUps: FollowUpRequest[];
  approvalPreference: ApprovalPreference;
}

export interface PublicationStepPlan {
  id?: string;
  sequence: number;
  stepType: StepType;
  relation: RelationType;
  replyToStepId: string | null;
  triggerType: TriggerType;
  triggerOffsetMinutes: number;
  resolvedDueAtMs: number | null;
  text: string;
  poll: PollContent | null;
  mediaIds: string[];
  weightedLength: number;
  madeWithAi: boolean;
  status: StepStatus;
  attemptCount: number;
  xPostId: string | null;
  publishedAtMs: number | null;
  nextAttemptAtMs: number | null;
  lastErrorCode: string | null;
  lastError: unknown;
}

export interface PublicationPlan {
  id?: string;
  kind: PlanKind;
  strategy: PlanStrategy;
  steps: PublicationStepPlan[];
  capabilityRequirements: {
    longform: LongformCapability | null;
    selfReply: SelfReplyCapability | null;
  };
  planHash: string;
  isActive: boolean;
  createdAtMs: number;
}

export interface PolicyResult {
  decision: PolicyDecision;
  reasons: string[];
}

export interface PublicationRecord {
  id: string;
  xAccountId: string;
  createdByClientId: string;
  status: PublicationStatus;
  kind: PublicationKind;
  revision: number;
  contentHash: string;
  request: PublicationRequest;
  overflowPolicy: OverflowPolicy;
  approvalPreference: ApprovalPreference;
  policyId: string | null;
  policyVersion: number | null;
  policyDecision: PolicyDecision;
  policyReasons: string[];
  approvalRequired: boolean;
  activeApprovalId: string | null;
  activePlanId: string | null;
  scheduledAtMs: number;
  nextActionAtMs: number | null;
  leaseToken: string | null;
  leaseUntilMs: number | null;
  rootPublishedAtMs: number | null;
  completedAtMs: number | null;
  failureCode: string | null;
  failure: unknown;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface ApprovalRecord {
  id: string;
  publicationId: string;
  revision: number;
  contentHash: string;
  decision: "APPROVED" | "REJECTED" | "REVOKED";
  actorClientId: string;
  comment: string | null;
  revokedAtMs: number | null;
  revokedReason: string | null;
  createdAtMs: number;
}

export interface PublicationBundle {
  publication: PublicationRecord;
  plans: PublicationPlan[];
  approvals: ApprovalRecord[];
}

export interface PreviewResult {
  normalized: {
    scheduledAtUtc: string;
    kind: PublicationKind;
  };
  plans: PublicationPlan[];
  policy: PolicyResult;
  capabilities: {
    longform: LongformCapability;
    selfReply: SelfReplyCapability;
  };
  estimate: {
    postCreateRequests: number;
    mediaUploads: number;
    threadParts: number;
  };
  warnings: string[];
  contentHash: string;
}
