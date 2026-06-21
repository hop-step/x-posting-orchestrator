import { evaluatePolicy } from "../domain/policies/policy-engine";
import type { PublicationPlan, PublicationRecord, PublicationStepPlan } from "../domain/publications/entities";
import { hasValidApproval } from "../application/publication-service";
import type { PublicationRepository } from "../application/repository";
import type { TokenManager } from "../application/token-manager";
import type { AppConfig } from "../env";
import type { UploadMediaResult, XClient } from "../infrastructure/x/x-client";
import type { Clock } from "../shared/clock";
import type { PublishQueueMessage } from "./messages";

type FailedUploadMediaResult = Exclude<UploadMediaResult, { type: "SUCCESS" }>;

export async function publishQueueMessage(params: {
  repository: PublicationRepository;
  xClient: XClient;
  tokenManager: TokenManager | null;
  mediaBucket: R2Bucket | null;
  clock: Clock;
  config: AppConfig;
  message: PublishQueueMessage;
}): Promise<"NOOP" | "PUBLISHED" | "FAILED" | "DELIVERY_UNKNOWN" | "RETRY_SCHEDULED" | "BLOCKED_POLICY"> {
  const { repository, message, clock } = params;
  if (message.version !== 1) {
    return "NOOP";
  }
  const bundle = await repository.getPublicationBundle(message.publicationId);
  if (bundle === null) {
    return "NOOP";
  }
  const publication = bundle.publication;
  if (
    publication.revision !== message.revision ||
    publication.contentHash !== message.contentHash ||
    publication.leaseToken !== message.leaseToken ||
    publication.status !== "QUEUED"
  ) {
    return "NOOP";
  }

  const [client, account, permission] = await Promise.all([
    repository.getClientById(publication.createdByClientId),
    repository.getXAccount(publication.xAccountId),
    repository.getClientAccountPermission(publication.createdByClientId, publication.xAccountId)
  ]);
  if (client === null || account === null || permission === null || client.status !== "ACTIVE" || account.status !== "ACTIVE") {
    await blockPolicy(repository, publication, clock.nowMs(), "AUTH_OR_ACCOUNT_INACTIVE");
    return "BLOCKED_POLICY";
  }

  const policy = evaluatePolicy({ request: publication.request, plans: bundle.plans, permission, account, nowMs: clock.nowMs(), allowPastScheduledAt: true });
  if (policy.decision === "DENY") {
    await blockPolicy(repository, publication, clock.nowMs(), policy.reasons[0] ?? "POLICY_DENIED");
    return "BLOCKED_POLICY";
  }
  if (policy.decision === "REQUIRE_APPROVAL" && !hasValidApproval(bundle)) {
    await repository.updatePublication({
      ...publication,
      status: "PENDING_APPROVAL",
      leaseToken: null,
      leaseUntilMs: null,
      nextActionAtMs: null,
      updatedAtMs: clock.nowMs()
    });
    return "NOOP";
  }

  const activePlan = getActivePlan(bundle.plans, publication.activePlanId);
  if (activePlan === null) {
    await blockPolicy(repository, publication, clock.nowMs(), "ACTIVE_PLAN_MISSING");
    return "BLOCKED_POLICY";
  }

  let workingPublication: PublicationRecord = {
    ...publication,
    status: "PUBLISHING",
    updatedAtMs: clock.nowMs()
  };
  await repository.updatePublication(workingPublication);
  const accessToken = params.tokenManager === null ? null : await params.tokenManager.getAccessToken(account);
  resolveFollowUpDueTimes(activePlan, clock.nowMs());
  const executableSteps = activePlan.steps.filter(
    (step) =>
      step.xPostId === null &&
      (step.stepType === "MAIN" || (step.stepType === "FOLLOW_UP" && step.resolvedDueAtMs !== null && step.resolvedDueAtMs <= clock.nowMs()))
  );

  for (const step of executableSteps) {
    if (step.xPostId !== null) {
      continue;
    }
    const replyToPostId = resolveReplyToPostId(activePlan, step);
    step.status = "PUBLISHING";
    step.attemptCount += 1;
    await repository.updatePublicationBundle({ ...bundle, publication: workingPublication, plans: replacePlan(bundle.plans, activePlan) });
    await repository.recordAuditLog({
      eventType: "PUBLICATION_PUBLISH_STARTED",
      actorClientId: client.id,
      xAccountId: account.id,
      publicationId: publication.id,
      requestId: null,
      contentHash: publication.contentHash,
      metadata: { stepId: step.id, attempt: step.attemptCount },
      createdAtMs: clock.nowMs()
    });

    const uploadedMedia = await uploadStepMedia({
      repository,
      xClient: params.xClient,
      mediaBucket: params.mediaBucket,
      localMediaIds: step.mediaIds,
      accessToken
    });
    if (!Array.isArray(uploadedMedia)) {
      const mediaResult = uploadedMedia;
      const status = mediaResult.type === "RATE_LIMITED" ? "RETRY_SCHEDULED" : mediaResult.type === "DEFINITE_FAILURE" ? "FAILED" : "DELIVERY_UNKNOWN";
      step.status = status;
      step.lastErrorCode = mediaResult.errorCode;
      step.lastError = mediaResult.error;
      await repository.updatePublicationBundle({
        ...bundle,
        publication: {
          ...workingPublication,
          status,
          nextActionAtMs: mediaResult.type === "RATE_LIMITED" ? mediaResult.retryAtMs : null,
          leaseToken: null,
          leaseUntilMs: null,
          failureCode: mediaResult.errorCode,
          failure: mediaResult.error,
          updatedAtMs: clock.nowMs()
        },
        plans: replacePlan(bundle.plans, activePlan)
      });
      return status;
    }

    const result = await params.xClient.createPost({
      text: step.text,
      poll: step.poll,
      mediaIds: uploadedMedia,
      replyToPostId,
      madeWithAi: step.madeWithAi,
      accessToken
    });

    if (result.type === "SUCCESS") {
      step.status = "PUBLISHED";
      step.xPostId = result.xPostId;
      step.publishedAtMs = clock.nowMs();
      workingPublication = {
        ...workingPublication,
        rootPublishedAtMs: workingPublication.rootPublishedAtMs ?? clock.nowMs(),
        updatedAtMs: clock.nowMs()
      };
      await repository.updatePublicationBundle({ ...bundle, publication: workingPublication, plans: replacePlan(bundle.plans, activePlan) });
      await repository.recordAuditLog({
        eventType: "PUBLICATION_STEP_PUBLISHED",
        actorClientId: client.id,
        xAccountId: account.id,
        publicationId: publication.id,
        requestId: null,
        contentHash: publication.contentHash,
        metadata: { stepId: step.id, xPostId: result.xPostId },
        createdAtMs: clock.nowMs()
      });
      continue;
    }

    if (result.type === "RATE_LIMITED") {
      step.status = "RETRY_SCHEDULED";
      step.nextAttemptAtMs = result.retryAtMs;
      step.lastErrorCode = result.errorCode;
      step.lastError = result.error;
      await repository.updatePublicationBundle({
        ...bundle,
        publication: {
          ...workingPublication,
          status: "RETRY_SCHEDULED",
          nextActionAtMs: result.retryAtMs,
          leaseToken: null,
          leaseUntilMs: null,
          updatedAtMs: clock.nowMs()
        },
        plans: replacePlan(bundle.plans, activePlan)
      });
      return "RETRY_SCHEDULED";
    }

    if (result.type === "FALLBACK_ELIGIBLE" && activePlan.strategy === "LONGFORM_SINGLE") {
      const fallback = bundle.plans.find((plan) => plan.kind === "FALLBACK");
      if (fallback !== undefined && hasValidApproval(bundle)) {
        await repository.updatePublication({
          ...workingPublication,
          status: "QUEUED",
          activePlanId: fallback.id ?? null,
          updatedAtMs: clock.nowMs()
        });
        return publishQueueMessage({ ...params, message });
      }
    }

    const status = result.type === "DEFINITE_FAILURE" ? "FAILED" : "DELIVERY_UNKNOWN";
    step.status = status;
    step.lastErrorCode = result.errorCode;
    step.lastError = result.error;
    await repository.updatePublicationBundle({
      ...bundle,
      publication: {
        ...workingPublication,
        status,
        nextActionAtMs: null,
        leaseToken: null,
        leaseUntilMs: null,
        failureCode: result.errorCode,
        failure: result.error,
        updatedAtMs: clock.nowMs()
      },
      plans: replacePlan(bundle.plans, activePlan)
    });
    await repository.recordAuditLog({
      eventType: status === "FAILED" ? "PUBLICATION_POLICY_BLOCKED" : "PUBLICATION_DELIVERY_UNKNOWN",
      actorClientId: client.id,
      xAccountId: account.id,
      publicationId: publication.id,
      requestId: null,
      contentHash: publication.contentHash,
      metadata: { stepId: step.id, errorCode: result.errorCode },
      createdAtMs: clock.nowMs()
    });
    return status;
  }

  resolveFollowUpDueTimes(activePlan, clock.nowMs());
  const remainingFollowUps = activePlan.steps.filter((step) => step.stepType === "FOLLOW_UP" && step.xPostId === null);
  if (remainingFollowUps.length > 0) {
    const nextActionAtMs = Math.min(...remainingFollowUps.map((step) => step.resolvedDueAtMs ?? clock.nowMs()));
    await repository.updatePublicationBundle({
      ...bundle,
      publication: {
        ...workingPublication,
        status: "AWAITING_FOLLOW_UP",
        nextActionAtMs,
        leaseToken: null,
        leaseUntilMs: null,
        updatedAtMs: clock.nowMs()
      },
      plans: replacePlan(bundle.plans, activePlan)
    });
    return "PUBLISHED";
  }

  const finalPublication: PublicationRecord = {
    ...workingPublication,
    status: "PUBLISHED",
    nextActionAtMs: null,
    leaseToken: null,
    leaseUntilMs: null,
    completedAtMs: clock.nowMs(),
    updatedAtMs: clock.nowMs()
  };
  await repository.updatePublicationBundle({ ...bundle, publication: finalPublication, plans: replacePlan(bundle.plans, activePlan) });
  return "PUBLISHED";
}

async function uploadStepMedia(params: {
  repository: PublicationRepository;
  xClient: XClient;
  mediaBucket: R2Bucket | null;
  localMediaIds: string[];
  accessToken: string | null;
}): Promise<string[] | FailedUploadMediaResult> {
  const uploaded: string[] = [];
  for (const localMediaId of params.localMediaIds) {
    const asset = await params.repository.getMediaAsset(localMediaId);
    if (asset === null || asset.status !== "READY") {
      return { type: "DEFINITE_FAILURE", httpStatus: 400, errorCode: "MEDIA_ASSET_NOT_READY", error: { mediaId: localMediaId } };
    }
    if (params.mediaBucket === null) {
      return { type: "DEFINITE_FAILURE", httpStatus: 400, errorCode: "MEDIA_BUCKET_UNAVAILABLE", error: { mediaId: localMediaId } };
    }
    const object = await params.mediaBucket.get(asset.r2Key);
    if (object === null) {
      return { type: "DEFINITE_FAILURE", httpStatus: 400, errorCode: "MEDIA_OBJECT_MISSING", error: { mediaId: localMediaId } };
    }
    const upload = await params.xClient.uploadMedia({
      bytes: new Uint8Array(await object.arrayBuffer()),
      mimeType: asset.mimeType,
      altText: asset.altText,
      aiGenerated: asset.aiGenerated,
      accessToken: params.accessToken
    });
    if (upload.type !== "SUCCESS") {
      return upload;
    }
    uploaded.push(upload.mediaId);
  }
  return uploaded;
}

function resolveFollowUpDueTimes(plan: PublicationPlan, nowMs: number): void {
  const root = plan.steps.find((step) => step.relation === "ROOT" && step.xPostId !== null && step.publishedAtMs !== null);
  if (root === undefined) {
    return;
  }
  const rootPublishedAtMs = root.publishedAtMs;
  if (rootPublishedAtMs === null) {
    return;
  }
  for (const step of plan.steps) {
    if (step.stepType !== "FOLLOW_UP" || step.resolvedDueAtMs !== null) {
      continue;
    }
    const pollMinutes = step.triggerType === "AFTER_POLL_CLOSE" ? (root.poll?.durationMinutes ?? 0) : 0;
    step.resolvedDueAtMs = rootPublishedAtMs + (pollMinutes + step.triggerOffsetMinutes) * 60 * 1000;
    if (step.resolvedDueAtMs < nowMs && step.triggerOffsetMinutes === 0) {
      step.resolvedDueAtMs = nowMs;
    }
  }
}

function getActivePlan(plans: PublicationPlan[], activePlanId: string | null): PublicationPlan | null {
  if (activePlanId === null) {
    return plans.find((plan) => plan.kind === "PRIMARY") ?? null;
  }
  return plans.find((plan) => plan.id === activePlanId) ?? null;
}

function replacePlan(plans: PublicationPlan[], activePlan: PublicationPlan): PublicationPlan[] {
  return plans.map((plan) => (plan.id === activePlan.id ? activePlan : plan));
}

function resolveReplyToPostId(plan: PublicationPlan, step: PublicationStepPlan): string | null {
  if (step.relation === "ROOT") {
    return null;
  }
  if (step.relation === "REPLY_PREVIOUS") {
    const previous = plan.steps.find((candidate) => candidate.sequence === step.sequence - 1);
    return previous?.xPostId ?? null;
  }
  if (step.replyToStepId !== null) {
    return plan.steps.find((candidate) => candidate.id === step.replyToStepId)?.xPostId ?? null;
  }
  return plan.steps[0]?.xPostId ?? null;
}

async function blockPolicy(repository: PublicationRepository, publication: PublicationRecord, nowMs: number, reason: string): Promise<void> {
  await repository.updatePublication({
    ...publication,
    status: "BLOCKED_POLICY",
    leaseToken: null,
    leaseUntilMs: null,
    nextActionAtMs: null,
    failureCode: reason,
    failure: { reason },
    updatedAtMs: nowMs
  });
}
