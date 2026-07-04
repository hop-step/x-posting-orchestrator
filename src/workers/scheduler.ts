import type { AppConfig } from "../env";
import type { Clock } from "../shared/clock";
import type { PublicationRepository } from "../application/repository";
import { errorMetadata, type Logger } from "../shared/logger";
import type { PublishQueueMessage } from "./messages";

export async function enqueueDuePublications(params: {
  repository: PublicationRepository;
  queue: Queue<PublishQueueMessage>;
  clock: Clock;
  config: AppConfig;
  limit?: number;
  logger?: Logger;
}): Promise<PublishQueueMessage[]> {
  const nowMs = params.clock.nowMs();
  const messages = await params.repository.claimDuePublications(nowMs, params.config.leaseDurationSeconds * 1000, params.limit ?? 25);
  for (const message of messages) {
    params.logger?.log("info", "PUBLICATION_QUEUE_CLAIMED", messageLogFields(message));
    await recordAuditLogSafely(params.repository, params.logger, {
      eventType: "PUBLICATION_QUEUE_CLAIMED",
      actorClientId: null,
      xAccountId: null,
      publicationId: message.publicationId,
      requestId: null,
      contentHash: message.contentHash,
      metadata: { reason: message.reason, enqueuedAtMs: message.enqueuedAtMs },
      createdAtMs: nowMs
    });
    try {
      await params.queue.send(message);
    } catch (error) {
      const metadata = errorMetadata(error);
      params.logger?.log("error", "PUBLICATION_QUEUE_SEND_FAILED", { ...messageLogFields(message), error: metadata });
      await recordAuditLogSafely(params.repository, params.logger, {
        eventType: "PUBLICATION_QUEUE_SEND_FAILED",
        actorClientId: null,
        xAccountId: null,
        publicationId: message.publicationId,
        requestId: null,
        contentHash: message.contentHash,
        metadata: { reason: message.reason, enqueuedAtMs: message.enqueuedAtMs, error: metadata },
        createdAtMs: nowMs
      });
      throw error;
    }
    params.logger?.log("info", "PUBLICATION_QUEUE_SEND_SUCCEEDED", messageLogFields(message));
    await recordAuditLogSafely(params.repository, params.logger, {
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

function messageLogFields(message: PublishQueueMessage): Record<string, unknown> {
  return {
    publicationId: message.publicationId,
    revision: message.revision,
    reason: message.reason,
    enqueuedAtMs: message.enqueuedAtMs
  };
}

async function recordAuditLogSafely(
  repository: PublicationRepository,
  logger: Logger | undefined,
  input: Parameters<PublicationRepository["recordAuditLog"]>[0]
): Promise<void> {
  try {
    await repository.recordAuditLog(input);
  } catch (error) {
    logger?.log("error", "PUBLICATION_AUDIT_LOG_WRITE_FAILED", {
      eventType: input.eventType,
      publicationId: input.publicationId,
      error: errorMetadata(error)
    });
  }
}
