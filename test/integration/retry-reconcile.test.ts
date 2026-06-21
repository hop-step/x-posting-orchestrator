import { describe, expect, it } from "vitest";
import { FakeXAdapter } from "../../src/infrastructure/x/fake-x-adapter";
import { publishQueueMessage } from "../../src/workers/publisher-consumer";
import type { PublishQueueMessage } from "../../src/workers/messages";
import { baseRequest, client, makeService, permission, requestMeta, scheduledAt, testConfig } from "../helpers/publication-fixtures";

describe("retry and reconcile operations", () => {
  it("forbids retry while delivery is unknown, then allows retry after NOT_PUBLISHED reconciliation", async () => {
    const human = client("human", "HUMAN");
    const { service, repository, clock } = makeService({ clients: [human], permissions: [permission(human.id, 3)] });
    const created = await service.create(baseRequest(), human, "idem-create", requestMeta());
    const publication = (created.body as { publication: { id: string } }).publication;
    clock.set(Date.parse(scheduledAt));
    const message = (await repository.claimDuePublications(clock.nowMs(), 120_000, 10))[0] as PublishQueueMessage;
    await publishQueueMessage({
      repository,
      xClient: new FakeXAdapter([{ type: "DELIVERY_UNKNOWN", errorCode: "X_TIMEOUT", error: {} }]),
      tokenManager: null,
      mediaBucket: null,
      clock,
      config: testConfig,
      message
    });
    await expect(service.retry(publication.id, human, "idem-retry-denied", requestMeta())).rejects.toMatchObject({ httpStatus: 409 });

    const unknown = await repository.getPublicationBundle(publication.id);
    const stepId = unknown?.plans[0]?.steps[0]?.id;
    if (stepId === undefined) {
      throw new Error("step missing");
    }
    await service.reconcile(
      publication.id,
      { stepId, outcome: "NOT_PUBLISHED", comment: "confirmed manually" },
      human,
      "idem-reconcile",
      requestMeta()
    );
    await expect(service.retry(publication.id, human, "idem-retry", requestMeta())).resolves.toMatchObject({
      body: { publication: { status: "RETRY_SCHEDULED" } }
    });
  });
});
