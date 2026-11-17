import { createXPublicationPublisher } from "../../src/infrastructure/x/x-publication-publisher";
import { publishQueueMessage } from "../../src/workers/publisher-consumer";
import type { PublishQueueMessage } from "../../src/workers/messages";

export function publishXQueueMessage(params: Parameters<typeof createXPublicationPublisher>[0] & { message: PublishQueueMessage }) {
  const { message, ...deps } = params;
  return publishQueueMessage({ repository: deps.repository, message, publisher: createXPublicationPublisher(deps) });
}
