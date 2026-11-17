import { loadQueuedPublication, type PublicationDeliveryResult, type PublicationPublisher } from "../application/publication-delivery";
import type { PublicationRepository } from "../application/repository";
import type { PublishQueueMessage } from "./messages";

export async function publishQueueMessage(params: {
  repository: Pick<PublicationRepository, "getPublicationBundle">;
  publisher: PublicationPublisher;
  message: PublishQueueMessage;
}): Promise<PublicationDeliveryResult> {
  const { repository, publisher, message } = params;
  const bundle = await loadQueuedPublication(repository, message);
  return bundle === null ? "NOOP" : publisher.publish(bundle, message);
}
