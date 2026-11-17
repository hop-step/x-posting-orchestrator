import type { ClientAccountPermission, XAccount } from "../domain/auth/types";
import type { PolicyResult, PreviewResult, PublicationPlan, PublicationRequest } from "../domain/publications/entities";
import type { AppConfig } from "../env";

// The adapter boundary still uses the existing X v1 data model in this phase.
interface PlanningContext {
  request: PublicationRequest;
  account: XAccount;
  nowMs: number;
}

export interface PublicationPlanning {
  buildPlans(params: PlanningContext & { config: AppConfig }): Promise<PublicationPlan[]>;
  evaluatePolicy(params: PlanningContext & {
    plans: PublicationPlan[];
    permission: ClientAccountPermission;
    allowPastScheduledAt?: boolean;
  }): PolicyResult;
  describePreview(
    request: PublicationRequest,
    account: XAccount,
    plans: PublicationPlan[]
  ): Pick<PreviewResult, "capabilities" | "estimate" | "warnings">;
}
