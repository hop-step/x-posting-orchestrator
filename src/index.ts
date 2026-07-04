import { createApp } from "./http/app";
import { loadConfig, type Env } from "./env";
import { TokenManager } from "./application/token-manager";
import { D1AppRepository } from "./infrastructure/d1/repositories/app-repository";
import { XRestAdapter } from "./infrastructure/x/x-rest-adapter";
import { systemClock } from "./shared/clock";
import { consoleLogger, errorMetadata } from "./shared/logger";
import { publishQueueMessage } from "./workers/publisher-consumer";
import { enqueueDuePublications } from "./workers/scheduler";
import type { PublishQueueMessage } from "./workers/messages";

const app = createApp();

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    return app.fetch(request, env, ctx);
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const repository = new D1AppRepository(env.DB);
    await enqueueDuePublications({
      repository,
      queue: env.PUBLISH_QUEUE,
      clock: systemClock,
      config: loadConfig(env),
      logger: consoleLogger
    });
  },

  async queue(batch: MessageBatch<PublishQueueMessage>, env: Env): Promise<void> {
    const repository = new D1AppRepository(env.DB);
    const tokenManager = new TokenManager(repository, env, systemClock);
    const xClient = new XRestAdapter();
    for (const message of batch.messages) {
      const body = message.body;
      consoleLogger.log("info", "PUBLICATION_QUEUE_MESSAGE_RECEIVED", messageLogFields(body));
      try {
        const result = await publishQueueMessage({
          repository,
          xClient,
          tokenManager,
          mediaBucket: env.MEDIA_BUCKET ?? null,
          clock: systemClock,
          config: loadConfig(env),
          message: body
        });
        consoleLogger.log("info", "PUBLICATION_QUEUE_MESSAGE_HANDLED", { ...messageLogFields(body), result });
      } catch (error) {
        const metadata = errorMetadata(error);
        consoleLogger.log("error", "PUBLICATION_QUEUE_CONSUMER_FAILED", { ...messageLogFields(body), error: metadata });
        await recordConsumerFailureAudit(repository, body, metadata);
        throw error;
      }
    }
  }
};

function messageLogFields(message: PublishQueueMessage): Record<string, unknown> {
  return {
    publicationId: message.publicationId,
    revision: message.revision,
    reason: message.reason,
    enqueuedAtMs: message.enqueuedAtMs
  };
}

async function recordConsumerFailureAudit(
  repository: D1AppRepository,
  message: PublishQueueMessage,
  error: Record<string, unknown>
): Promise<void> {
  try {
    await repository.recordAuditLog({
      eventType: "PUBLICATION_QUEUE_CONSUMER_FAILED",
      actorClientId: null,
      xAccountId: null,
      publicationId: message.publicationId,
      requestId: null,
      contentHash: message.contentHash,
      metadata: { reason: message.reason, enqueuedAtMs: message.enqueuedAtMs, error },
      createdAtMs: systemClock.nowMs()
    });
  } catch (auditError) {
    consoleLogger.log("error", "PUBLICATION_QUEUE_CONSUMER_FAILURE_AUDIT_FAILED", {
      ...messageLogFields(message),
      error: errorMetadata(auditError)
    });
  }
}
