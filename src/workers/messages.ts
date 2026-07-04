export interface PublishQueueMessage {
  version: 1;
  publicationId: string;
  revision: number;
  contentHash: string;
  leaseToken: string;
  reason: "SCHEDULED" | "FOLLOW_UP" | "RETRY" | "RECOVERY";
  enqueuedAtMs: number;
}
