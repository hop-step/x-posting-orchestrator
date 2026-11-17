import type { PublicationPlanning } from "../../application/publication-platform";
import { evaluatePolicy } from "../../domain/policies/policy-engine";
import { buildPublicationPlans } from "../../domain/publications/planner";

export const xPublicationPlanning: PublicationPlanning = {
  buildPlans: buildPublicationPlans,
  evaluatePolicy,
  describePreview(request, account, plans) {
    return {
      capabilities: {
        longform: account.longformCapability,
        selfReply: account.selfReplyCapability
      },
      estimate: {
        postCreateRequests: plans[0]?.steps.length ?? 0,
        mediaUploads: request.content.mediaIds.length,
        threadParts: plans[0]?.steps.filter((step) => step.stepType === "MAIN").length ?? 0
      },
      warnings: []
    };
  }
};
