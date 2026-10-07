import type { AppConfig } from "../../env";
import { unprocessable } from "../../shared/errors";
import type { XAccount } from "../auth/types";
import type { PlanStrategy, PublicationPlan, PublicationRequest, PublicationStepPlan } from "./entities";
import { planHash } from "./canonical-hash";
import { splitIntoThread } from "./splitter";
import {
  characterCount,
  LONGFORM_POST_CHARACTER_LIMIT,
  STANDARD_POST_WEIGHTED_LENGTH,
  weightedLength
} from "./weighted-text";

export interface BuildPlansParams {
  request: PublicationRequest;
  account: XAccount;
  nowMs: number;
  config: AppConfig;
}

export async function buildPublicationPlans(params: BuildPlansParams): Promise<PublicationPlan[]> {
  const { request, account, nowMs, config } = params;
  validateKindConstraints(request, config);
  const primarySteps = buildMainSteps(request, account);
  const primaryStrategy = strategyForPrimary(request, primarySteps.length);
  const steps = appendFollowUps(primarySteps, request);
  const primaryBase = {
    kind: "PRIMARY" as const,
    strategy: primaryStrategy,
    steps,
    capabilityRequirements: {
      longform: requiresLongform(steps) ? ("ENABLED" as const) : null,
      selfReply: requiresSelfReply(primarySteps, request) ? ("ENABLED" as const) : null
    },
    isActive: true
  };
  const primary: PublicationPlan = {
    ...primaryBase,
    planHash: await planHash(primaryBase),
    createdAtMs: nowMs
  };

  const plans = [primary];
  if (request.overflowPolicy === "LONGFORM_THEN_THREAD" && weightedLength(request.content.text) > STANDARD_POST_WEIGHTED_LENGTH) {
    const fallbackSteps = appendFollowUps(buildThreadSteps(request), request);
    const fallbackBase = {
      kind: "FALLBACK" as const,
      strategy: "THREAD" as const,
      steps: fallbackSteps,
      capabilityRequirements: {
        longform: requiresLongform(fallbackSteps) ? ("ENABLED" as const) : null,
        selfReply: "ENABLED" as const
      },
      isActive: false
    };
    plans.push({
      ...fallbackBase,
      planHash: await planHash(fallbackBase),
      createdAtMs: nowMs
    });
  }
  return plans;
}

function validateKindConstraints(request: PublicationRequest, config: AppConfig): void {
  const hasMedia = request.content.mediaIds.length > 0;
  const hasPoll = request.content.poll !== null;
  ensureLongformLimit(request.content.text, "TEXT_TOO_LONG");
  for (const followUp of request.followUps) {
    ensureLongformLimit(followUp.content.text, "FOLLOW_UP_TOO_LONG");
  }
  if (hasMedia && hasPoll) {
    throw unprocessable("IMAGE_AND_POLL_NOT_ALLOWED", "Images and polls cannot be attached to the same publication.");
  }
  if (hasMedia && request.content.mediaIds.length > config.maxImageCount) {
    throw unprocessable("TOO_MANY_IMAGES", "Too many images.", { maxImageCount: config.maxImageCount });
  }
  if (request.kind === "IMAGE" && !hasMedia) {
    throw unprocessable("IMAGE_MEDIA_REQUIRED", "IMAGE publications require mediaIds.");
  }
  if (request.kind === "TEXT" && hasMedia) {
    throw unprocessable("TEXT_MEDIA_NOT_ALLOWED", "TEXT publications cannot include images.");
  }
  if (request.kind !== "POLL" && hasPoll) {
    throw unprocessable("POLL_KIND_REQUIRED", "Poll content requires kind POLL.");
  }
  if (request.kind === "POLL" && !hasPoll) {
    throw unprocessable("POLL_REQUIRED", "POLL publications require poll content.");
  }
  if (request.kind === "POLL") {
    if (request.overflowPolicy !== "REJECT") {
      throw unprocessable("POLL_OVERFLOW_POLICY_INVALID", "Poll publications must use single-post overflow policy REJECT.");
    }
  }
}

function buildMainSteps(request: PublicationRequest, account: XAccount): PublicationStepPlan[] {
  const length = weightedLength(request.content.text);
  if (length <= STANDARD_POST_WEIGHTED_LENGTH) {
    return [
      baseStep({
        sequence: 1,
        text: request.content.text,
        relation: "ROOT",
        poll: request.content.poll,
        mediaIds: request.content.mediaIds,
        madeWithAi: request.content.madeWithAi
      })
    ];
  }

  if (request.overflowPolicy !== "THREAD") {
    return [
      baseStep({
        sequence: 1,
        text: request.content.text,
        relation: "ROOT",
        poll: request.content.poll,
        mediaIds: request.content.mediaIds,
        madeWithAi: request.content.madeWithAi
      })
    ];
  }
  if (account.selfReplyCapability !== "ENABLED") {
    throw unprocessable("SELF_REPLY_CAPABILITY_REQUIRED", "Thread publication requires verified self-reply capability.");
  }
  return buildThreadSteps(request);
}

function buildThreadSteps(request: PublicationRequest): PublicationStepPlan[] {
  const parts = splitIntoThread(request.content.text, request.threadOptions);
  return parts.map((part, index) =>
    baseStep({
      sequence: index + 1,
      text: part,
      relation: index === 0 ? "ROOT" : "REPLY_PREVIOUS",
      poll: null,
      mediaIds: index === 0 ? request.content.mediaIds : [],
      madeWithAi: request.content.madeWithAi
    })
  );
}

function appendFollowUps(steps: PublicationStepPlan[], request: PublicationRequest): PublicationStepPlan[] {
  if (request.followUps.length === 0) {
    return steps;
  }
  return [
    ...steps,
    ...request.followUps.map((followUp, index) => {
      return baseStep({
        sequence: steps.length + index + 1,
        text: followUp.content.text,
        relation: "REPLY_STEP",
        poll: null,
        mediaIds: [],
        madeWithAi: false,
        stepType: "FOLLOW_UP",
        triggerType: followUp.trigger.type,
        triggerOffsetMinutes: followUp.trigger.offsetMinutes
      });
    })
  ];
}

function strategyForPrimary(request: PublicationRequest, mainStepCount: number): PlanStrategy {
  if (weightedLength(request.content.text) > STANDARD_POST_WEIGHTED_LENGTH && mainStepCount === 1) {
    return "LONGFORM_SINGLE";
  }
  return mainStepCount === 1 ? "STANDARD_SINGLE" : "THREAD";
}

function requiresSelfReply(mainSteps: PublicationStepPlan[], request: PublicationRequest): boolean {
  return mainSteps.some((step) => step.relation !== "ROOT") || request.followUps.length > 0;
}

function requiresLongform(steps: PublicationStepPlan[]): boolean {
  return steps.some((step) => step.weightedLength > STANDARD_POST_WEIGHTED_LENGTH);
}

function ensureLongformLimit(text: string, errorCode: "TEXT_TOO_LONG" | "FOLLOW_UP_TOO_LONG"): void {
  const count = characterCount(text);
  if (count > LONGFORM_POST_CHARACTER_LIMIT) {
    throw unprocessable(errorCode, "Text exceeds the X Premium longform post limit.", {
      characterCount: count,
      maxCharacterCount: LONGFORM_POST_CHARACTER_LIMIT
    });
  }
}

function baseStep(input: {
  sequence: number;
  text: string;
  relation: PublicationStepPlan["relation"];
  poll: PublicationStepPlan["poll"];
  mediaIds: string[];
  madeWithAi: boolean;
  stepType?: PublicationStepPlan["stepType"];
  triggerType?: PublicationStepPlan["triggerType"];
  triggerOffsetMinutes?: number;
}): PublicationStepPlan {
  return {
    sequence: input.sequence,
    stepType: input.stepType ?? "MAIN",
    relation: input.relation,
    replyToStepId: null,
    triggerType: input.triggerType ?? "AT_PUBLICATION_TIME",
    triggerOffsetMinutes: input.triggerOffsetMinutes ?? 0,
    resolvedDueAtMs: null,
    text: input.text,
    poll: input.poll,
    mediaIds: input.mediaIds,
    weightedLength: weightedLength(input.text),
    madeWithAi: input.madeWithAi,
    status: "PENDING",
    attemptCount: 0,
    xPostId: null,
    publishedAtMs: null,
    nextAttemptAtMs: null,
    lastErrorCode: null,
    lastError: null
  };
}
