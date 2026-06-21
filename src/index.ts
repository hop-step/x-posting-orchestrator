import { createApp } from "./http/app";
import { loadConfig, type Env } from "./env";
import { TokenManager } from "./application/token-manager";
import { D1AppRepository } from "./infrastructure/d1/repositories/app-repository";
import { XRestAdapter } from "./infrastructure/x/x-rest-adapter";
import { systemClock } from "./shared/clock";
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
      config: loadConfig(env)
    });
  },

  async queue(batch: MessageBatch<PublishQueueMessage>, env: Env): Promise<void> {
    const repository = new D1AppRepository(env.DB);
    const tokenManager = new TokenManager(repository, env, systemClock);
    const xClient = new XRestAdapter();
    for (const message of batch.messages) {
      await publishQueueMessage({
        repository,
        xClient,
        tokenManager,
        mediaBucket: env.MEDIA_BUCKET,
        clock: systemClock,
        config: loadConfig(env),
        message: message.body
      });
    }
  }
};
