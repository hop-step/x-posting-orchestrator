import { evaluatePolicy } from "../domain/policies/policy-engine";
import type { XAccount } from "../domain/auth/types";
import type { PublicationPlan, PublicationRecord, PublicationStepPlan } from "../domain/publications/entities";
import { hasValidApproval } from "../application/publication-service";
import type { PublicationRepository } from "../application/repository";
import type { TokenManager } from "../application/token-manager";
import type { AppConfig } from "../env";
import type { RecentPost, UploadMediaResult, XClient, XDeliveryUnknown } from "../infrastructure/x/x-client";
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
    const replyToPostId = resolveReplyToPostId(publication, activePlan, step);
    if (shouldVerifyBeforeRetry(step)) {
      const verification = await verifyRecentDelivery({
        xClient: params.xClient,
        account,
        accessToken,
        step,
        replyToPostId,
        clock,
        config: params.config
      });
      if (verification.type === "FOUND") {
        workingPublication = await markStepPublishedFromRecentPost({
          repository,
          bundle,
          activePlan,
          workingPublication,
          step,
          post: verification.post,
          clientId: client.id,
          accountId: account.id,
          clock
        });
        continue;
      }
      if (verification.type === "UNAVAILABLE") {
        return finishDeliveryUnknown({
          repository,
          bundle,
          activePlan,
          workingPublication,
          step,
          clientId: client.id,
          accountId: account.id,
          contentHash: publication.contentHash,
          clock,
          errorCode: step.lastErrorCode ?? verification.errorCode,
          error: {
            delivery: step.lastError,
            verification: {
              errorCode: verification.errorCode,
              error: verification.error
            }
          }
        });
      }
    }
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
      step.nextAttemptAtMs = null;
      step.lastErrorCode = null;
      step.lastError = null;
      workingPublication = {
        ...workingPublication,
        rootPublishedAtMs: workingPublication.rootPublishedAtMs ?? clock.nowMs(),
        failureCode: null,
        failure: null,
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

    if (result.type === "DELIVERY_UNKNOWN") {
      const outcome = await handleDeliveryUnknownPostResult({
        repository,
        xClient: params.xClient,
        bundle,
        activePlan,
        workingPublication,
        step,
        result,
        clientId: client.id,
        account,
        accessToken,
        replyToPostId,
        contentHash: publication.contentHash,
        clock,
        config: params.config
      });
      if (outcome.type === "PUBLISHED") {
        workingPublication = outcome.publication;
        continue;
      }
      return outcome.status;
    }

    const status = "FAILED";
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
    failureCode: null,
    failure: null,
    completedAtMs: clock.nowMs(),
    updatedAtMs: clock.nowMs()
  };
  await repository.updatePublicationBundle({ ...bundle, publication: finalPublication, plans: replacePlan(bundle.plans, activePlan) });
  return "PUBLISHED";
}

type DeliveryVerificationResult =
  | { type: "FOUND"; post: RecentPost }
  | { type: "NOT_FOUND" }
  | { type: "UNAVAILABLE"; errorCode: string; error: unknown };

type DeliveryUnknownPostOutcome =
  | { type: "PUBLISHED"; publication: PublicationRecord }
  | { type: "STOPPED"; status: "DELIVERY_UNKNOWN" | "RETRY_SCHEDULED" };

async function handleDeliveryUnknownPostResult(params: {
  repository: PublicationRepository;
  xClient: XClient;
  bundle: Parameters<PublicationRepository["updatePublicationBundle"]>[0];
  activePlan: PublicationPlan;
  workingPublication: PublicationRecord;
  step: PublicationStepPlan;
  result: XDeliveryUnknown;
  clientId: string;
  account: XAccount;
  accessToken: string | null;
  replyToPostId: string | null;
  contentHash: string;
  clock: Clock;
  config: AppConfig;
}): Promise<DeliveryUnknownPostOutcome> {
  const verification = await verifyRecentDelivery({
    xClient: params.xClient,
    account: params.account,
    accessToken: params.accessToken,
    step: params.step,
    replyToPostId: params.replyToPostId,
    clock: params.clock,
    config: params.config
  });
  if (verification.type === "FOUND") {
    return {
      type: "PUBLISHED",
      publication: await markStepPublishedFromRecentPost({
        repository: params.repository,
        bundle: params.bundle,
        activePlan: params.activePlan,
        workingPublication: params.workingPublication,
        step: params.step,
        post: verification.post,
        clientId: params.clientId,
        accountId: params.account.id,
        clock: params.clock
      })
    };
  }

  if (verification.type === "NOT_FOUND" && params.step.attemptCount < params.config.deliveryUnknownMaxAttempts) {
    await scheduleDeliveryUnknownRetry({
      repository: params.repository,
      bundle: params.bundle,
      activePlan: params.activePlan,
      workingPublication: params.workingPublication,
      step: params.step,
      result: params.result,
      clientId: params.clientId,
      accountId: params.account.id,
      contentHash: params.contentHash,
      clock: params.clock,
      config: params.config
    });
    return { type: "STOPPED", status: "RETRY_SCHEDULED" };
  }

  const error =
    verification.type === "UNAVAILABLE"
      ? {
          delivery: params.result.error,
          verification: {
            errorCode: verification.errorCode,
            error: verification.error
          }
        }
      : params.result.error;
  await finishDeliveryUnknown({
    repository: params.repository,
    bundle: params.bundle,
    activePlan: params.activePlan,
    workingPublication: params.workingPublication,
    step: params.step,
    clientId: params.clientId,
    accountId: params.account.id,
    contentHash: params.contentHash,
    clock: params.clock,
    errorCode: params.result.errorCode,
    error
  });
  return { type: "STOPPED", status: "DELIVERY_UNKNOWN" };
}

async function verifyRecentDelivery(params: {
  xClient: XClient;
  account: XAccount;
  accessToken: string | null;
  step: PublicationStepPlan;
  replyToPostId: string | null;
  clock: Clock;
  config: AppConfig;
}): Promise<DeliveryVerificationResult> {
  if (params.account.xUserId === null) {
    return { type: "UNAVAILABLE", errorCode: "X_USER_ID_MISSING", error: { xAccountId: params.account.id } };
  }
  const result = await params.xClient.listRecentPosts({
    userId: params.account.xUserId,
    maxResults: 5,
    accessToken: params.accessToken
  });
  if (result.type !== "SUCCESS") {
    return { type: "UNAVAILABLE", errorCode: result.errorCode, error: result.error };
  }
  const sinceMs = params.clock.nowMs() - params.config.deliveryUnknownVerificationWindowSeconds * 1000;
  const post = result.posts.find((candidate) => matchesRecentPost(candidate, params.step, params.replyToPostId, sinceMs));
  return post === undefined ? { type: "NOT_FOUND" } : { type: "FOUND", post };
}

function matchesRecentPost(post: RecentPost, step: PublicationStepPlan, replyToPostId: string | null, sinceMs: number): boolean {
  if (post.createdAtMs !== null && post.createdAtMs < sinceMs) {
    return false;
  }
  if (normalizePostText(post.text) !== normalizePostText(step.text)) {
    return false;
  }
  const repliedToIds = post.referencedPosts.filter((reference) => reference.type === "replied_to").map((reference) => reference.id);
  if (replyToPostId === null) {
    return repliedToIds.length === 0;
  }
  return repliedToIds.includes(replyToPostId);
}

function normalizePostText(value: string): string {
  return value.replace(/\r\n?/gu, "\n").trim();
}

function shouldVerifyBeforeRetry(step: PublicationStepPlan): boolean {
  return step.status === "RETRY_SCHEDULED" && step.attemptCount > 0 && step.lastErrorCode !== "X_RATE_LIMITED";
}

async function markStepPublishedFromRecentPost(params: {
  repository: PublicationRepository;
  bundle: Parameters<PublicationRepository["updatePublicationBundle"]>[0];
  activePlan: PublicationPlan;
  workingPublication: PublicationRecord;
  step: PublicationStepPlan;
  post: RecentPost;
  clientId: string;
  accountId: string;
  clock: Clock;
}): Promise<PublicationRecord> {
  const publishedAtMs = params.post.createdAtMs ?? params.clock.nowMs();
  params.step.status = "PUBLISHED";
  params.step.xPostId = params.post.id;
  params.step.publishedAtMs = publishedAtMs;
  params.step.nextAttemptAtMs = null;
  params.step.lastErrorCode = null;
  params.step.lastError = null;
  const publication = {
    ...params.workingPublication,
    rootPublishedAtMs: params.workingPublication.rootPublishedAtMs ?? publishedAtMs,
    failureCode: null,
    failure: null,
    updatedAtMs: params.clock.nowMs()
  };
  await params.repository.updatePublicationBundle({ ...params.bundle, publication, plans: replacePlan(params.bundle.plans, params.activePlan) });
  await params.repository.recordAuditLog({
    eventType: "PUBLICATION_DELIVERY_VERIFIED",
    actorClientId: params.clientId,
    xAccountId: params.accountId,
    publicationId: publication.id,
    requestId: null,
    contentHash: publication.contentHash,
    metadata: { stepId: params.step.id, xPostId: params.post.id },
    createdAtMs: params.clock.nowMs()
  });
  await params.repository.recordAuditLog({
    eventType: "PUBLICATION_STEP_PUBLISHED",
    actorClientId: params.clientId,
    xAccountId: params.accountId,
    publicationId: publication.id,
    requestId: null,
    contentHash: publication.contentHash,
    metadata: { stepId: params.step.id, xPostId: params.post.id, recoveredFromDeliveryUnknown: true },
    createdAtMs: params.clock.nowMs()
  });
  return publication;
}

async function scheduleDeliveryUnknownRetry(params: {
  repository: PublicationRepository;
  bundle: Parameters<PublicationRepository["updatePublicationBundle"]>[0];
  activePlan: PublicationPlan;
  workingPublication: PublicationRecord;
  step: PublicationStepPlan;
  result: XDeliveryUnknown;
  clientId: string;
  accountId: string;
  contentHash: string;
  clock: Clock;
  config: AppConfig;
}): Promise<void> {
  const retryAtMs = params.clock.nowMs() + params.config.deliveryUnknownRetryDelaySeconds * 1000;
  params.step.status = "RETRY_SCHEDULED";
  params.step.nextAttemptAtMs = retryAtMs;
  params.step.lastErrorCode = params.result.errorCode;
  params.step.lastError = params.result.error;
  await params.repository.updatePublicationBundle({
    ...params.bundle,
    publication: {
      ...params.workingPublication,
      status: "RETRY_SCHEDULED",
      nextActionAtMs: retryAtMs,
      leaseToken: null,
      leaseUntilMs: null,
      updatedAtMs: params.clock.nowMs()
    },
    plans: replacePlan(params.bundle.plans, params.activePlan)
  });
  await params.repository.recordAuditLog({
    eventType: "PUBLICATION_DELIVERY_UNKNOWN_RETRY_SCHEDULED",
    actorClientId: params.clientId,
    xAccountId: params.accountId,
    publicationId: params.workingPublication.id,
    requestId: null,
    contentHash: params.contentHash,
    metadata: { stepId: params.step.id, errorCode: params.result.errorCode, attempt: params.step.attemptCount, retryAtMs },
    createdAtMs: params.clock.nowMs()
  });
}

async function finishDeliveryUnknown(params: {
  repository: PublicationRepository;
  bundle: Parameters<PublicationRepository["updatePublicationBundle"]>[0];
  activePlan: PublicationPlan;
  workingPublication: PublicationRecord;
  step: PublicationStepPlan;
  clientId: string;
  accountId: string;
  contentHash: string;
  clock: Clock;
  errorCode: string;
  error: unknown;
}): Promise<"DELIVERY_UNKNOWN"> {
  params.step.status = "DELIVERY_UNKNOWN";
  params.step.nextAttemptAtMs = null;
  params.step.lastErrorCode = params.errorCode;
  params.step.lastError = params.error;
  await params.repository.updatePublicationBundle({
    ...params.bundle,
    publication: {
      ...params.workingPublication,
      status: "DELIVERY_UNKNOWN",
      nextActionAtMs: null,
      leaseToken: null,
      leaseUntilMs: null,
      failureCode: params.errorCode,
      failure: params.error,
      updatedAtMs: params.clock.nowMs()
    },
    plans: replacePlan(params.bundle.plans, params.activePlan)
  });
  await params.repository.recordAuditLog({
    eventType: "PUBLICATION_DELIVERY_UNKNOWN",
    actorClientId: params.clientId,
    xAccountId: params.accountId,
    publicationId: params.workingPublication.id,
    requestId: null,
    contentHash: params.contentHash,
    metadata: { stepId: params.step.id, errorCode: params.errorCode },
    createdAtMs: params.clock.nowMs()
  });
  return "DELIVERY_UNKNOWN";
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

function resolveReplyToPostId(publication: PublicationRecord, plan: PublicationPlan, step: PublicationStepPlan): string | null {
  if (step.relation === "ROOT") {
    return publication.request.replyToPostId ?? null;
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
