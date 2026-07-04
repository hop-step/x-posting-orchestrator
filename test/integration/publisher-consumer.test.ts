import { describe, expect, it } from "vitest";
import { TokenManager } from "../../src/application/token-manager";
import { encryptToken } from "../../src/infrastructure/crypto/token-crypto";
import { FakeXAdapter } from "../../src/infrastructure/x/fake-x-adapter";
import { publishQueueMessage } from "../../src/workers/publisher-consumer";
import { enqueueDuePublications } from "../../src/workers/scheduler";
import type { Env } from "../../src/env";
import type { PublishQueueMessage } from "../../src/workers/messages";
import { client, makeService, permission, baseRequest, requestMeta, scheduledAt, testConfig } from "../helpers/publication-fixtures";

describe("scheduler and publisher consumer", () => {
  it("publishes a scheduled publication once even if the same message is delivered twice", async () => {
    const serviceClient = client("svc", "SERVICE");
    const { service, repository, clock } = makeService({ clients: [serviceClient], permissions: [permission(serviceClient.id, 3)] });
    const created = await service.create(baseRequest(), serviceClient, "idem-create", requestMeta());
    const publication = (created.body as { publication: { id: string } }).publication;
    clock.set(Date.parse(scheduledAt));
    const sent: PublishQueueMessage[] = [];
    const messages = await enqueueDuePublications({
      repository,
      queue: { send: async (message: PublishQueueMessage) => void sent.push(message) } as unknown as Queue<PublishQueueMessage>,
      clock,
      config: testConfig
    });
    expect(messages).toHaveLength(1);
    expect(sent[0]?.publicationId).toBe(publication.id);
    expect(repository.auditLogs.map((log) => log.eventType)).toEqual(
      expect.arrayContaining(["PUBLICATION_QUEUE_CLAIMED", "PUBLICATION_QUEUED"])
    );

    const fakeX = new FakeXAdapter();
    await expect(
      publishQueueMessage({ repository, xClient: fakeX, tokenManager: null, mediaBucket: null, clock, config: testConfig, message: messages[0] as PublishQueueMessage })
    ).resolves.toBe("PUBLISHED");
    await expect(
      publishQueueMessage({ repository, xClient: fakeX, tokenManager: null, mediaBucket: null, clock, config: testConfig, message: messages[0] as PublishQueueMessage })
    ).resolves.toBe("NOOP");
    expect(fakeX.calls).toHaveLength(1);
    expect((await repository.getPublicationBundle(publication.id))?.publication.status).toBe("PUBLISHED");
  });

  it("recovers an expired queued publication when queue delivery did not start", async () => {
    const serviceClient = client("svc", "SERVICE");
    const { service, repository, clock } = makeService({ clients: [serviceClient], permissions: [permission(serviceClient.id, 3)] });
    const created = await service.create(baseRequest(), serviceClient, "idem-create", requestMeta());
    const publication = (created.body as { publication: { id: string } }).publication;
    clock.set(Date.parse(scheduledAt));

    await expect(
      enqueueDuePublications({
        repository,
        queue: { send: async () => Promise.reject(new Error("queue unavailable")) } as unknown as Queue<PublishQueueMessage>,
        clock,
        config: testConfig
      })
    ).rejects.toThrow("queue unavailable");
    const stuck = await repository.getPublicationBundle(publication.id);
    expect(stuck?.publication.status).toBe("QUEUED");
    expect(repository.auditLogs.map((log) => log.eventType)).toEqual(
      expect.arrayContaining(["PUBLICATION_QUEUE_CLAIMED", "PUBLICATION_QUEUE_SEND_FAILED"])
    );

    expect(await repository.claimDuePublications(clock.nowMs() + 119_000, 120_000, 10)).toHaveLength(0);
    clock.advance(121_000);
    const recoveredSent: PublishQueueMessage[] = [];
    const recovered = await enqueueDuePublications({
      repository,
      queue: { send: async (message: PublishQueueMessage) => void recoveredSent.push(message) } as unknown as Queue<PublishQueueMessage>,
      clock,
      config: testConfig
    });
    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.reason).toBe("RECOVERY");
    expect(recoveredSent[0]?.publicationId).toBe(publication.id);
    expect(repository.auditLogs.some((log) => log.eventType === "PUBLICATION_QUEUED" && log.metadata.reason === "RECOVERY")).toBe(true);

    const fakeX = new FakeXAdapter();
    await expect(
      publishQueueMessage({
        repository,
        xClient: fakeX,
        tokenManager: null,
        mediaBucket: null,
        clock,
        config: testConfig,
        message: recovered[0] as PublishQueueMessage
      })
    ).resolves.toBe("PUBLISHED");
    expect(fakeX.calls).toHaveLength(1);
  });

  it("no-ops cancelled publications and old revision messages", async () => {
    const serviceClient = client("svc", "SERVICE");
    const { service, repository, clock } = makeService({ clients: [serviceClient], permissions: [permission(serviceClient.id, 3)] });
    const created = await service.create(baseRequest(), serviceClient, "idem-create", requestMeta());
    const publication = (created.body as { publication: { id: string } }).publication;
    clock.set(Date.parse(scheduledAt));
    const messages = await repository.claimDuePublications(clock.nowMs(), 120_000, 10);
    const bundle = await repository.getPublicationBundle(publication.id);
    if (bundle === null) {
      throw new Error("bundle missing");
    }
    await repository.updatePublication({ ...bundle.publication, status: "CANCELLED", updatedAtMs: clock.nowMs() });
    const fakeX = new FakeXAdapter();
    await expect(
      publishQueueMessage({ repository, xClient: fakeX, tokenManager: null, mediaBucket: null, clock, config: testConfig, message: messages[0] as PublishQueueMessage })
    ).resolves.toBe("NOOP");
    expect(fakeX.calls).toHaveLength(0);

    const staleMessage = { ...(messages[0] as PublishQueueMessage), revision: 999 };
    await expect(publishQueueMessage({ repository, xClient: fakeX, tokenManager: null, mediaBucket: null, clock, config: testConfig, message: staleMessage })).resolves.toBe(
      "NOOP"
    );
  });

  it("handles rate limit, definite failure, and delivery unknown without unsafe retry", async () => {
    const serviceClient = client("svc", "SERVICE");

    const rate = makeService({ clients: [serviceClient], permissions: [permission(serviceClient.id, 3)] });
    await rate.service.create(baseRequest(), serviceClient, "idem-rate", requestMeta());
    rate.clock.set(Date.parse(scheduledAt));
    const rateMsg = (await rate.repository.claimDuePublications(rate.clock.nowMs(), 120_000, 10))[0] as PublishQueueMessage;
    await expect(
      publishQueueMessage({
        repository: rate.repository,
        xClient: new FakeXAdapter([{ type: "RATE_LIMITED", retryAtMs: rate.clock.nowMs() + 60_000, httpStatus: 429, errorCode: "X_RATE_LIMITED", error: {} }]),
        tokenManager: null,
        mediaBucket: null,
        clock: rate.clock,
        config: testConfig,
        message: rateMsg
      })
    ).resolves.toBe("RETRY_SCHEDULED");

    const failure = makeService({ clients: [serviceClient], permissions: [permission(serviceClient.id, 3)] });
    const failureCreated = await failure.service.create(baseRequest(), serviceClient, "idem-fail", requestMeta());
    failure.clock.set(Date.parse(scheduledAt));
    const failureMsg = (await failure.repository.claimDuePublications(failure.clock.nowMs(), 120_000, 10))[0] as PublishQueueMessage;
    await expect(
      publishQueueMessage({
        repository: failure.repository,
        xClient: new FakeXAdapter([{ type: "DEFINITE_FAILURE", httpStatus: 400, errorCode: "X_HTTP_400", error: {} }]),
        tokenManager: null,
        mediaBucket: null,
        clock: failure.clock,
        config: testConfig,
        message: failureMsg
      })
    ).resolves.toBe("FAILED");
    expect((await failure.repository.getPublicationBundle((failureCreated.body as { publication: { id: string } }).publication.id))?.publication.status).toBe("FAILED");

    const unknown = makeService({ clients: [serviceClient], permissions: [permission(serviceClient.id, 3)] });
    await unknown.service.create(baseRequest(), serviceClient, "idem-unknown", requestMeta());
    unknown.clock.set(Date.parse(scheduledAt));
    const unknownMsg = (await unknown.repository.claimDuePublications(unknown.clock.nowMs(), 120_000, 10))[0] as PublishQueueMessage;
    const fakeX = new FakeXAdapter([{ type: "DELIVERY_UNKNOWN", errorCode: "X_TIMEOUT", error: {} }]);
    await expect(
      publishQueueMessage({ repository: unknown.repository, xClient: fakeX, tokenManager: null, mediaBucket: null, clock: unknown.clock, config: testConfig, message: unknownMsg })
    ).resolves.toBe("DELIVERY_UNKNOWN");
    await expect(
      publishQueueMessage({ repository: unknown.repository, xClient: fakeX, tokenManager: null, mediaBucket: null, clock: unknown.clock, config: testConfig, message: unknownMsg })
    ).resolves.toBe("NOOP");
    expect(fakeX.calls).toHaveLength(1);
  });

  it("refreshes tokens and stores rotated refresh tokens", async () => {
    const serviceClient = client("svc", "SERVICE");
    const secret = "a".repeat(64);
    const refresh = await encryptToken("old-refresh", secret);
    const { repository, clock } = makeService({ clients: [serviceClient], permissions: [permission(serviceClient.id, 3)] });
    const existing = repository.accounts.get("acc_1");
    if (existing === undefined) {
      throw new Error("account missing");
    }
    repository.accounts.set("acc_1", {
      ...existing,
      accessTokenCiphertext: refresh.ciphertext,
      accessTokenIv: refresh.iv,
      refreshTokenCiphertext: refresh.ciphertext,
      refreshTokenIv: refresh.iv,
      accessTokenExpiresAtMs: clock.nowMs() - 1000,
      tokenKeyVersion: 1
    });
    const tokenManager = new TokenManager(
      repository,
      {
        TOKEN_ENCRYPTION_KEY_V1: secret,
        X_CLIENT_ID: "client-id",
        X_CLIENT_SECRET: "client-secret",
        TOKEN_REFRESH_MARGIN_MINUTES: "10"
      } as Env,
      clock,
      async () =>
        new Response(JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 7200, scope: "tweet.write" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
    );
    await expect(tokenManager.getAccessToken(repository.accounts.get("acc_1") ?? existing)).resolves.toBe("new-access");
    expect(repository.accounts.get("acc_1")?.accessTokenExpiresAtMs).toBeGreaterThan(clock.nowMs());
  });
});
