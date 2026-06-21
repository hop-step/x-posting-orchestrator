import type { AppConfig } from "../env";
import type { Clock } from "../shared/clock";
import type { PublicationRepository } from "../application/repository";
import type { PublishQueueMessage } from "./messages";

export async function enqueueDuePublications(params: {
  repository: PublicationRepository;
  queue: Queue<PublishQueueMessage>;
  clock: Clock;
  config: AppConfig;
  limit?: number;
}): Promise<PublishQueueMessage[]> {
  const nowMs = params.clock.nowMs();
  const messages = await params.repository.claimDuePublications(nowMs, params.config.leaseDurationSeconds * 1000, params.limit ?? 25);
  for (const message of messages) {
    await params.queue.send(message);
    await params.repository.recordAuditLog({
      eventType: "PUBLICATION_QUEUED",
      actorClientId: null,
      xAccountId: null,
      publicationId: message.publicationId,
      requestId: null,
      contentHash: message.contentHash,
      metadata: { reason: message.reason },
      createdAtMs: nowMs
    });
  }
  return messages;
}
