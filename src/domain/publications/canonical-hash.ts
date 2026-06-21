import { sha256Canonical } from "../../shared/crypto";
import type { PublicationPlan, PublicationRequest } from "./entities";

export async function planHash(plan: Omit<PublicationPlan, "planHash" | "id" | "createdAtMs">): Promise<string> {
  return sha256Canonical({
    kind: plan.kind,
    strategy: plan.strategy,
    capabilityRequirements: plan.capabilityRequirements,
    steps: plan.steps.map((step) => ({
      sequence: step.sequence,
      stepType: step.stepType,
      relation: step.relation,
      triggerType: step.triggerType,
      triggerOffsetMinutes: step.triggerOffsetMinutes,
      text: step.text,
      poll: step.poll,
      mediaIds: step.mediaIds,
      weightedLength: step.weightedLength,
      madeWithAi: step.madeWithAi
    }))
  });
}

export async function contentHashForApproval(params: {
  xAccountId: string;
  scheduledAtMs: number;
  request: PublicationRequest;
  revision: number;
  plans: PublicationPlan[];
}): Promise<string> {
  return sha256Canonical({
    xAccountId: params.xAccountId,
    scheduledAtMs: params.scheduledAtMs,
    normalizedText: params.request.content.text,
    mediaIds: params.request.content.mediaIds,
    poll: params.request.content.poll,
    followUps: params.request.followUps,
    primaryPlan: params.plans.find((plan) => plan.kind === "PRIMARY") ?? null,
    fallbackPlan: params.plans.find((plan) => plan.kind === "FALLBACK") ?? null,
    overflowPolicy: params.request.overflowPolicy,
    revision: params.revision
  });
}
