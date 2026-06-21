import type { ClientAccountPermission, XAccount } from "../auth/types";
import type { PolicyResult, PublicationPlan, PublicationRequest } from "../publications/entities";
import { STANDARD_POST_WEIGHTED_LENGTH, weightedLength } from "../publications/weighted-text";

const urlPattern = /https?:\/\/[^\s]+/iu;
const mentionPattern = /(^|[^\w])@[A-Za-z0-9_]{1,15}\b/u;
const prohibitedPatterns = [/無料で確実に稼げる/u, /必ず合格/u];

export function evaluatePolicy(params: {
  request: PublicationRequest;
  plans: PublicationPlan[];
  permission: ClientAccountPermission;
  account: XAccount;
  nowMs: number;
}): PolicyResult {
  const { request, plans, permission, account, nowMs } = params;
  const reasons: string[] = [];

  if (request.scheduledAtMs <= nowMs) {
    return deny("SCHEDULED_AT_IN_PAST");
  }
  if (permission.permissionLevel === 0) {
    return deny("PERMISSION_LEVEL_DENY");
  }
  if (account.status !== "ACTIVE") {
    return deny("X_ACCOUNT_INACTIVE");
  }
  if (plans.some((plan) => plan.strategy === "THREAD") && account.selfReplyCapability !== "ENABLED") {
    return deny("SELF_REPLY_CAPABILITY_REQUIRED");
  }
  if (request.followUps.length > 0 && account.selfReplyCapability !== "ENABLED") {
    return deny("SELF_REPLY_CAPABILITY_REQUIRED");
  }
  if (prohibitedPatterns.some((pattern) => pattern.test(request.content.text))) {
    return deny("PROHIBITED_PATTERN");
  }

  const primary = plans.find((plan) => plan.kind === "PRIMARY");
  if (primary === undefined) {
    return deny("PRIMARY_PLAN_MISSING");
  }
  if (request.approvalPreference === "REQUIRE_APPROVAL") {
    reasons.push("CALLER_REQUESTED_APPROVAL");
  }
  if (permission.permissionLevel === 2) {
    reasons.push("PERMISSION_LEVEL_REQUIRES_HUMAN_APPROVAL");
  }
  if (request.kind === "IMAGE") {
    reasons.push("IMAGE_REQUIRES_HUMAN_APPROVAL");
  }
  if (request.kind === "POLL") {
    reasons.push("POLL_REQUIRES_HUMAN_APPROVAL");
  }
  if (request.followUps.length > 0) {
    reasons.push("FOLLOW_UP_REQUIRES_HUMAN_APPROVAL");
  }
  if (primary.strategy !== "STANDARD_SINGLE") {
    reasons.push("NON_STANDARD_PLAN_REQUIRES_HUMAN_APPROVAL");
  }
  if (weightedLength(request.content.text) > STANDARD_POST_WEIGHTED_LENGTH) {
    reasons.push("LONG_TEXT_REQUIRES_HUMAN_APPROVAL");
  }
  if (urlPattern.test(request.content.text)) {
    reasons.push("URL_REQUIRES_HUMAN_APPROVAL");
  }
  if (mentionPattern.test(request.content.text)) {
    reasons.push("MENTION_REQUIRES_HUMAN_APPROVAL");
  }
  if (primary.steps.length > 1) {
    reasons.push("THREAD_REQUIRES_HUMAN_APPROVAL");
  }
  if (permission.allowedHours !== null && !permission.allowedHours.includes(new Date(request.scheduledAtMs).getUTCHours())) {
    reasons.push("OUTSIDE_ALLOWED_HOURS_REQUIRES_HUMAN_APPROVAL");
  }
  if (account.longformCapability !== "ENABLED" && primary.strategy === "LONGFORM_SINGLE") {
    reasons.push("LONGFORM_CAPABILITY_NOT_ENABLED");
  }

  if (reasons.length > 0) {
    return {
      decision: "REQUIRE_APPROVAL",
      reasons
    };
  }
  return {
    decision: "ALLOW",
    reasons: []
  };
}

function deny(reason: string): PolicyResult {
  return {
    decision: "DENY",
    reasons: [reason]
  };
}
