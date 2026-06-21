import { conflict } from "../../shared/errors";
import type { PublicationStatus } from "./entities";

const editableStatuses: ReadonlySet<PublicationStatus> = new Set(["DRAFT", "PENDING_APPROVAL", "SCHEDULED"]);
const cancellableStatuses: ReadonlySet<PublicationStatus> = new Set(["DRAFT", "PENDING_APPROVAL", "SCHEDULED", "QUEUED"]);

export function assertEditable(status: PublicationStatus): void {
  if (!editableStatuses.has(status)) {
    throw conflict("PUBLICATION_NOT_EDITABLE", "Publication cannot be edited in its current status.", { status });
  }
}

export function assertCancellable(status: PublicationStatus, hasPublishedSteps: boolean): void {
  if (hasPublishedSteps) {
    throw conflict("PUBLICATION_ALREADY_PUBLISHED", "Publication has already created at least one X post.");
  }
  if (!cancellableStatuses.has(status)) {
    throw conflict("PUBLICATION_NOT_CANCELLABLE", "Publication cannot be cancelled in its current status.", { status });
  }
}
