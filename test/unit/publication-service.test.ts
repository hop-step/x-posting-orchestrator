import { describe, expect, it } from "vitest";
import { AppError } from "../../src/shared/errors";
import { client, account, permission, makeService, baseRequest, requestMeta, scheduledAt } from "../helpers/publication-fixtures";

describe("PublicationService permissions and approvals", () => {
  it("blocks permission level 0 from publication creation", async () => {
    const deny = client("deny", "SERVICE");
    const { service } = makeService({ clients: [deny], permissions: [permission(deny.id, 0)] });
    await expect(service.create(baseRequest(), deny, "idem-1", requestMeta())).rejects.toMatchObject({ httpStatus: 403 });
  });

  it("creates DRAFT for level 1 and allows a level 2 human to submit it", async () => {
    const drafter = client("drafter", "SERVICE");
    const human = client("human", "HUMAN");
    const { service } = makeService({
      clients: [drafter, human],
      permissions: [permission(drafter.id, 1), permission(human.id, 2)]
    });
    const created = await service.create(baseRequest(), drafter, "idem-draft", requestMeta());
    expect((created.body as { publication: { status: string } }).publication.status).toBe("DRAFT");
    const id = (created.body as { publication: { id: string } }).publication.id;
    const submitted = await service.submit(id, human, "idem-submit", requestMeta(`/v1/publications/${id}/submit`));
    expect((submitted.body as { publication: { status: string } }).publication.status).toBe("PENDING_APPROVAL");
  });

  it("creates PENDING_APPROVAL for level 2", async () => {
    const human = client("human", "HUMAN");
    const { service } = makeService({ clients: [human], permissions: [permission(human.id, 2)] });
    const created = await service.create(baseRequest(), human, "idem-l2", requestMeta());
    expect((created.body as { publication: { status: string } }).publication.status).toBe("PENDING_APPROVAL");
  });

  it("lists publications by accessible X account, not only by creating client", async () => {
    const ai = client("ai", "AI", ["publication:preview", "publication:create", "publication:read"]);
    const human = client("human", "HUMAN", ["publication:read"]);
    const { service } = makeService({
      clients: [ai, human],
      permissions: [permission(ai.id, 2), permission(human.id, 2)]
    });
    const created = await service.create(baseRequest(), ai, "idem-ai-create", requestMeta());
    const publicationId = (created.body as { publication: { id: string } }).publication.id;

    const listed = await service.list(human, 100);

    expect(listed.map((bundle) => bundle.publication.id)).toContain(publicationId);
    expect(listed[0]?.publication.createdByClientId).toBe(ai.id);
  });

  it("schedules safe level 3 text and requires approval for URL, image, poll, and thread", async () => {
    const serviceClient = client("svc", "SERVICE");
    const { service } = makeService({ clients: [serviceClient], permissions: [permission(serviceClient.id, 3)] });
    await expect(service.create(baseRequest(), serviceClient, "idem-safe", requestMeta())).resolves.toMatchObject({
      body: { publication: { status: "SCHEDULED" } }
    });
    await expect(
      service.create(baseRequest({ content: { text: "https://example.com を見てください" } }), serviceClient, "idem-url", requestMeta())
    ).resolves.toMatchObject({ body: { publication: { status: "PENDING_APPROVAL" } } });
    await expect(
      service.create(baseRequest({ kind: "IMAGE", content: { text: "画像です", mediaIds: ["media_1"] } }), serviceClient, "idem-image", requestMeta())
    ).resolves.toMatchObject({ body: { publication: { status: "PENDING_APPROVAL" } } });
    await expect(
      service.create(
        baseRequest({ kind: "POLL", content: { text: "どちら？", poll: { options: ["A", "B"], durationMinutes: 60 } } }),
        serviceClient,
        "idem-poll",
        requestMeta()
      )
    ).resolves.toMatchObject({ body: { publication: { status: "PENDING_APPROVAL" } } });
    await expect(
      service.create(
        baseRequest({ content: { text: "あ".repeat(200) }, overflowPolicy: "THREAD", threadOptions: { numbering: true, maxParts: 10, mediaPlacement: "FIRST" } }),
        serviceClient,
        "idem-thread",
        requestMeta()
      )
    ).resolves.toMatchObject({ body: { publication: { status: "PENDING_APPROVAL" } } });
  });

  it("prevents AI actors from approving even if a bad seed includes the scope", async () => {
    const human = client("human", "HUMAN");
    const ai = client("ai", "AI");
    const { service } = makeService({
      clients: [human, ai],
      permissions: [permission(human.id, 2), permission(ai.id, 2)]
    });
    const created = await service.create(baseRequest(), human, "idem-create", requestMeta());
    const publication = (created.body as { publication: { id: string; revision: number; contentHash: string } }).publication;
    await expect(
      service.approve(publication.id, { revision: publication.revision, contentHash: publication.contentHash }, ai, "idem-ai", requestMeta())
    ).rejects.toMatchObject({ httpStatus: 403 });
  });

  it("invalidates approval after editing", async () => {
    const human = client("human", "HUMAN");
    const { service, repository } = makeService({ clients: [human], permissions: [permission(human.id, 2)] });
    const created = await service.create(baseRequest(), human, "idem-create", requestMeta());
    const publication = (created.body as { publication: { id: string; revision: number; contentHash: string } }).publication;
    await service.approve(publication.id, { revision: publication.revision, contentHash: publication.contentHash }, human, "idem-approve", requestMeta());
    const patched = await service.patch(
      publication.id,
      baseRequest({ content: { text: "修正後の本文" } }),
      human,
      "idem-patch",
      requestMeta(`/v1/publications/${publication.id}`)
    );
    expect((patched.body as { publication: { revision: number; status: string } }).publication.revision).toBe(2);
    expect((patched.body as { approval: { activeApprovalId: string | null } }).approval.activeApprovalId).toBeNull();
    const bundle = await repository.getPublicationBundle(publication.id);
    expect(bundle?.approvals[0]?.decision).toBe("REVOKED");
  });

  it("returns the same response for repeated idempotent requests and 409 for key conflicts", async () => {
    const serviceClient = client("svc", "SERVICE");
    const { service, repository } = makeService({ clients: [serviceClient], permissions: [permission(serviceClient.id, 3)] });
    const first = await service.create(baseRequest(), serviceClient, "idem-same", requestMeta());
    const second = await service.create(baseRequest(), serviceClient, "idem-same", requestMeta());
    expect(second.body).toEqual(first.body);
    expect(repository.publications.size).toBe(1);
    await expect(service.create(baseRequest({ scheduledAt: "2026-06-23T12:00:00+09:00" }), serviceClient, "idem-same", requestMeta())).rejects.toMatchObject({
      httpStatus: 409
    });
  });

  it("requires self-reply capability for poll follow-ups", async () => {
    const serviceClient = client("svc", "SERVICE");
    const { service } = makeService({
      clients: [serviceClient],
      accounts: [account({ selfReplyCapability: "UNVERIFIED" })],
      permissions: [permission(serviceClient.id, 3)]
    });
    await expect(
      service.create(
        baseRequest({
          scheduledAt,
          kind: "POLL",
          content: { text: "どちら？", poll: { options: ["A", "B"], durationMinutes: 60 } },
          followUps: [{ trigger: { type: "AFTER_POLL_CLOSE", offsetMinutes: 5 }, content: { text: "ありがとうございました" } }]
        }),
        serviceClient,
        "idem-followup",
        requestMeta()
      )
    ).rejects.toThrow(AppError);
  });
});
