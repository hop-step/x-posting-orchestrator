import type { PublicationBundle } from "../domain/publications/entities";
import type { PublishQueueMessage } from "../workers/messages";
import type { PublicationRepository } from "./repository";

export type PublicationDeliveryResult =
  | "NOOP"
  | "PUBLISHED"
  | "FAILED"
  | "DELIVERY_UNKNOWN"
  | "RETRY_SCHEDULED"
  | "BLOCKED_POLICY";

export interface PublicationPublisher {
  publish(bundle: PublicationBundle, message: PublishQueueMessage): Promise<PublicationDeliveryResult>;
}

export async function loadQueuedPublication(
  repository: Pick<PublicationRepository, "getPublicationBundle">,
  message: PublishQueueMessage
): Promise<PublicationBundle | null> {
  if (message.version !== 1) {
    return null;
  }
  const bundle = await repository.getPublicationBundle(message.publicationId);
  if (bundle === null) {
    return null;
  }
  const { publication } = bundle;
  if (
    publication.revision !== message.revision ||
    publication.contentHash !== message.contentHash ||
    publication.leaseToken !== message.leaseToken ||
    publication.status !== "QUEUED"
  ) {
    return null;
  }
  return bundle;
}
