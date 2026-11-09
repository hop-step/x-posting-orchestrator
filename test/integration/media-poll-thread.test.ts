import { describe, expect, it } from "vitest";
import type { MediaAsset } from "../../src/domain/media/entities";
import { FakeXAdapter } from "../../src/infrastructure/x/fake-x-adapter";
import { publishQueueMessage } from "../../src/workers/publisher-consumer";
import type { PublishQueueMessage } from "../../src/workers/messages";
import { baseRequest, client, makeService, nowMs, permission, requestMeta, scheduledAt } from "../helpers/publication-fixtures";
import { testConfig } from "../helpers/publication-fixtures";

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("media, poll follow-up, and thread publishing", () => {
  it("uploads R2 media to X before creating an image post", async () => {
    const human = client("human", "HUMAN");
    const { service, repository, clock } = makeService({ clients: [human], permissions: [permission(human.id, 3)] });
    await repository.createMediaAsset(mediaAsset(human.id));
    const created = await service.create(baseRequest({ kind: "IMAGE", content: { text: "画像つき投稿", mediaIds: ["media_1"] } }), human, "idem-image", requestMeta());
    const publication = (created.body as { publication: { id: string; revision: number; contentHash: string } }).publication;
    await service.approve(publication.id, { revision: publication.revision, contentHash: publication.contentHash }, human, "idem-approve", requestMeta());
    clock.set(Date.parse(scheduledAt));
    const message = (await repository.claimDuePublications(clock.nowMs(), 120_000, 10))[0] as PublishQueueMessage;
    const fakeX = new FakeXAdapter();
    await expect(
      publishQueueMessage({
        repository,
        xClient: fakeX,
        tokenManager: null,
        mediaBucket: fakeBucket(),
        clock,
        config: testConfig,
        message
      })
    ).resolves.toBe("PUBLISHED");
    expect(fakeX.mediaUploads).toHaveLength(1);
    expect(fakeX.calls[0]?.mediaIds).toEqual(["xmedia_1"]);
  });

  it("calculates poll follow-up due time from actual root publish time", async () => {
    const human = client("human", "HUMAN");
    const { service, repository, clock } = makeService({ clients: [human], permissions: [permission(human.id, 3)] });
    const created = await service.create(
      baseRequest({
        kind: "POLL",
        content: { text: "どちら？", poll: { options: ["A", "B"], durationMinutes: 60 } },
        followUps: [{ trigger: { type: "AFTER_POLL_CLOSE", offsetMinutes: 5 }, content: { text: "回答ありがとうございました" } }]
      }),
      human,
      "idem-poll",
      requestMeta()
    );
    const publication = (created.body as { publication: { id: string; revision: number; contentHash: string } }).publication;
    await service.approve(publication.id, { revision: publication.revision, contentHash: publication.contentHash }, human, "idem-approve", requestMeta());
    clock.set(Date.parse(scheduledAt));
    const rootMessage = (await repository.claimDuePublications(clock.nowMs(), 120_000, 10))[0] as PublishQueueMessage;
    const fakeX = new FakeXAdapter();
    await expect(
      publishQueueMessage({ repository, xClient: fakeX, tokenManager: null, mediaBucket: null, clock, config: testConfig, message: rootMessage })
    ).resolves.toBe("PUBLISHED");
    const awaiting = await repository.getPublicationBundle(publication.id);
    expect(awaiting?.publication.status).toBe("AWAITING_FOLLOW_UP");
    expect(awaiting?.publication.nextActionAtMs).toBe(clock.nowMs() + 65 * 60 * 1000);

    clock.set(clock.nowMs() + 65 * 60 * 1000);
    const followMessage = (await repository.claimDuePublications(clock.nowMs(), 120_000, 10))[0] as PublishQueueMessage;
    await expect(
      publishQueueMessage({ repository, xClient: fakeX, tokenManager: null, mediaBucket: null, clock, config: testConfig, message: followMessage })
    ).resolves.toBe("PUBLISHED");
    expect(fakeX.calls).toHaveLength(2);
    expect(fakeX.calls[1]?.replyToPostId).toBe("0000000001");
    expect((await repository.getPublicationBundle(publication.id))?.publication.status).toBe("PUBLISHED");
  });

  it("does not resend successful thread steps after a later step fails", async () => {
    const human = client("human", "HUMAN");
    const { service, repository, clock } = makeService({ clients: [human], permissions: [permission(human.id, 3)] });
    const created = await service.create(
      baseRequest({
        content: { text: "あ".repeat(200) },
        overflowPolicy: "THREAD",
        threadOptions: { numbering: true, maxParts: 10, mediaPlacement: "FIRST" }
      }),
      human,
      "idem-thread",
      requestMeta()
    );
    const publication = (created.body as { publication: { id: string; revision: number; contentHash: string } }).publication;
    await service.approve(publication.id, { revision: publication.revision, contentHash: publication.contentHash }, human, "idem-approve", requestMeta());
    clock.set(Date.parse(scheduledAt));
    const firstMessage = (await repository.claimDuePublications(clock.nowMs(), 120_000, 10))[0] as PublishQueueMessage;
    const firstFake = new FakeXAdapter([{ type: "SUCCESS", xPostId: "root-post", text: "" }, { type: "DEFINITE_FAILURE", httpStatus: 400, errorCode: "X_HTTP_400", error: {} }]);
    await expect(
      publishQueueMessage({ repository, xClient: firstFake, tokenManager: null, mediaBucket: null, clock, config: testConfig, message: firstMessage })
    ).resolves.toBe("FAILED");
    expect(firstFake.calls).toHaveLength(2);

    const failed = await repository.getPublicationBundle(publication.id);
    if (failed === null) {
      throw new Error("bundle missing");
    }
    await repository.updatePublication({ ...failed.publication, status: "RETRY_SCHEDULED", nextActionAtMs: clock.nowMs(), leaseToken: null, leaseUntilMs: null });
    const retryMessage = (await repository.claimDuePublications(clock.nowMs(), 120_000, 10))[0] as PublishQueueMessage;
    const retryFake = new FakeXAdapter();
    await expect(
      publishQueueMessage({ repository, xClient: retryFake, tokenManager: null, mediaBucket: null, clock, config: testConfig, message: retryMessage })
    ).resolves.toBe("PUBLISHED");
    expect(retryFake.calls).toHaveLength(1);
    expect(retryFake.calls[0]?.replyToPostId).toBe("root-post");
  });

  it.each(["AFTER_PARENT_PUBLISHED", "AFTER_POLL_CLOSE"] as const)("publishes a level 4 long poll and long explanation with %s without approval", async (triggerType) => {
    const ai = client("ai", "AI");
    const { service, repository, clock } = makeService({ clients: [ai], permissions: [permission(ai.id, 4)] });
    const text = "Question ".repeat(40);
    const explanation = "Explanation ".repeat(40);
    const created = await service.create(baseRequest({
      kind: "POLL",
      content: { text, poll: { options: ["True", "False", "Unknown"], durationMinutes: 60 } },
      followUps: [{ trigger: { type: triggerType, offsetMinutes: 5 }, content: { text: explanation } }]
    }), ai, "idem-level-four", requestMeta());
    const publication = (created.body as { publication: { id: string; status: string } }).publication;
    expect(publication.status).toBe("SCHEDULED");
    const fakeX = new FakeXAdapter();

    clock.set(Date.parse(scheduledAt) + 60_000);
    const [rootMessage] = await repository.claimDuePublications(clock.nowMs(), 120_000, 10);
    if (rootMessage === undefined) {
      throw new Error("Root was not scheduled.");
    }
    await expect(publishQueueMessage({ repository, xClient: fakeX, tokenManager: null, mediaBucket: null, clock, config: testConfig, message: rootMessage })).resolves.toBe("PUBLISHED");
    const dueAt = clock.nowMs() + (triggerType === "AFTER_PARENT_PUBLISHED" ? 5 : 65) * 60_000;
    const awaiting = await repository.getPublicationBundle(publication.id);
    expect(awaiting?.publication.status).toBe("AWAITING_FOLLOW_UP");
    expect(awaiting?.publication.nextActionAtMs).toBe(dueAt);
    expect(fakeX.calls).toHaveLength(1);
    expect(fakeX.calls[0]?.text).toBe(text.trim());
    expect(fakeX.calls[0]?.poll?.options).toEqual(["True", "False", "Unknown"]);

    clock.set(dueAt - 1);
    expect(await repository.claimDuePublications(clock.nowMs(), 120_000, 10)).toEqual([]);
    clock.set(dueAt);
    const [followMessage] = await repository.claimDuePublications(clock.nowMs(), 120_000, 10);
    if (followMessage === undefined) {
      throw new Error("Follow-up was not scheduled.");
    }
    await expect(publishQueueMessage({ repository, xClient: fakeX, tokenManager: null, mediaBucket: null, clock, config: testConfig, message: followMessage })).resolves.toBe("PUBLISHED");
    expect(fakeX.calls).toHaveLength(2);
    expect(fakeX.calls[1]?.text).toBe(explanation.trim());
    expect(fakeX.calls[1]?.replyToPostId).toBe("0000000001");
    const completed = await repository.getPublicationBundle(publication.id);
    expect(completed?.publication.status).toBe("PUBLISHED");
    expect(completed?.approvals).toEqual([]);
  });

  it("rechecks permission downgrades before publishing a level 4 poll", async () => {
    const ai = client("ai", "AI");
    const accountPermission = permission(ai.id, 4);
    const { service, repository, clock } = makeService({ clients: [ai], permissions: [accountPermission] });
    const created = await service.create(baseRequest({
      kind: "POLL",
      content: { text: "Question", poll: { options: ["True", "False"], durationMinutes: 60 } }
    }), ai, "idem-level-four", requestMeta());
    const publication = (created.body as { publication: { id: string } }).publication;
    clock.set(Date.parse(scheduledAt));
    const [message] = await repository.claimDuePublications(clock.nowMs(), 120_000, 10);
    if (message === undefined) {
      throw new Error("Publication was not scheduled.");
    }
    accountPermission.permissionLevel = 3;
    const fakeX = new FakeXAdapter();
    await expect(publishQueueMessage({ repository, xClient: fakeX, tokenManager: null, mediaBucket: null, clock, config: testConfig, message })).resolves.toBe("NOOP");
    expect(fakeX.calls).toHaveLength(0);
    expect((await repository.getPublicationBundle(publication.id))?.publication.status).toBe("PENDING_APPROVAL");
  });

  it("publishes a scheduled text post as a reply to an existing X post ID", async () => {
    const serviceClient = client("svc", "SERVICE");
    const { service, repository, clock } = makeService({ clients: [serviceClient], permissions: [permission(serviceClient.id, 3)] });
    const created = await service.create(
      baseRequest({
        replyToPostId: "2072314870444540211",
        content: { text: "【誤】が正しい！\n\n【解説】\n局所への穏やかな刺激によって痒みを抑える効果を期待して、熱感刺激を生じさせるクロタミトンが配合されている場合がある。" }
      }),
      serviceClient,
      "idem-external-reply",
      requestMeta()
    );
    const publication = (created.body as { publication: { id: string; status: string } }).publication;
    expect(publication.status).toBe("SCHEDULED");
    clock.set(Date.parse(scheduledAt));
    const message = (await repository.claimDuePublications(clock.nowMs(), 120_000, 10))[0] as PublishQueueMessage;
    const fakeX = new FakeXAdapter();
    await expect(
      publishQueueMessage({ repository, xClient: fakeX, tokenManager: null, mediaBucket: null, clock, config: testConfig, message })
    ).resolves.toBe("PUBLISHED");
    expect(fakeX.calls).toHaveLength(1);
    expect(fakeX.calls[0]?.replyToPostId).toBe("2072314870444540211");
  });
});

function mediaAsset(clientId: string): MediaAsset {
  return {
    id: "media_1",
    xAccountId: "acc_1",
    createdByClientId: clientId,
    r2Key: "acc_1/media_1",
    originalFilename: "image.png",
    mimeType: "image/png",
    sizeBytes: pngBytes.byteLength,
    sha256: "sha",
    altText: "alt",
    aiGenerated: false,
    status: "READY",
    expiresAtMs: null,
    createdAtMs: nowMs,
    updatedAtMs: nowMs
  };
}

function fakeBucket(): R2Bucket {
  return {
    get: async () =>
      ({
        arrayBuffer: async () => pngBytes.buffer
      }) as R2ObjectBody
  } as unknown as R2Bucket;
}
