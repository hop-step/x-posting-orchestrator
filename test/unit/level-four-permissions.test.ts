import { describe, expect, it } from "vitest";
import { baseRequest, client, makeService, permission, account, requestMeta, scheduledAt } from "../helpers/publication-fixtures";

const longText = "a".repeat(300);
const poll = { options: ["True", "False", "Unknown"], durationMinutes: 10080 };
const followUps = (text = "Explanation") => [
  { trigger: { type: "AFTER_PARENT_PUBLISHED", offsetMinutes: 5 }, content: { text } }
];
const extendedRequest = () => baseRequest({ kind: "POLL", content: { text: longText, poll }, followUps: followUps(longText) });

describe("level 4 extended automatic publishing", () => {
  it.each([
    { name: "poll", overrides: { kind: "POLL", content: { text: "Question", poll } } },
    { name: "follow-up", overrides: { followUps: followUps() } },
    { name: "longform", overrides: { content: { text: longText } } },
    { name: "long follow-up", overrides: { followUps: followUps(longText) } },
    { name: "long poll with long follow-up", overrides: { kind: "POLL", content: { text: longText, poll }, followUps: followUps(longText) } },
    { name: "25,000-character post", overrides: { content: { text: "a".repeat(25_000) } } }
  ])("previews and schedules $name without approval", async ({ overrides }) => {
    const ai = client("ai", "AI");
    const { service, repository } = makeService({ clients: [ai], permissions: [permission(ai.id, 4)] });
    const request = baseRequest(overrides);
    expect((await service.preview(request, ai)).policy).toEqual({ decision: "ALLOW", reasons: [] });

    const created = await service.create(request, ai, "idem-create", requestMeta());
    expect(created.body).toMatchObject({ publication: { status: "SCHEDULED" }, policy: { decision: "ALLOW", reasons: [] } });
    const id = (created.body as { publication: { id: string } }).publication.id;
    const bundle = await repository.getPublicationBundle(id);
    expect(bundle?.publication.approvalRequired).toBe(false);
    expect(bundle?.publication.nextActionAtMs).toBe(Date.parse(scheduledAt));
    expect(bundle?.approvals).toEqual([]);
  });

  it.each([1, 2, 3] as const)("keeps level %i unchanged for an extended publication", async (level) => {
    const ai = client("ai", "AI");
    const { service } = makeService({ clients: [ai], permissions: [permission(ai.id, level)] });
    const created = await service.create(extendedRequest(), ai, "idem-create", requestMeta());
    expect(created.body).toMatchObject({
      publication: { status: level === 1 ? "DRAFT" : "PENDING_APPROVAL" },
      policy: { decision: "REQUIRE_APPROVAL" }
    });
    expect((created.body as { policy: { reasons: string[] } }).policy.reasons).toEqual(expect.arrayContaining([
      "POLL_REQUIRES_HUMAN_APPROVAL", "FOLLOW_UP_REQUIRES_HUMAN_APPROVAL", "LONG_TEXT_REQUIRES_HUMAN_APPROVAL"
    ]));
  });

  it.each([
    { name: "explicit approval", overrides: { approvalPreference: "REQUIRE_APPROVAL" }, reason: "CALLER_REQUESTED_APPROVAL" },
    { name: "root URL", overrides: { content: { text: "https://example.com" } }, reason: "URL_REQUIRES_HUMAN_APPROVAL" },
    { name: "root mention", overrides: { content: { text: "Hello @example" } }, reason: "MENTION_REQUIRES_HUMAN_APPROVAL" },
    { name: "image", overrides: { kind: "IMAGE", content: { text: "Image", mediaIds: ["media_1"] } }, reason: "IMAGE_REQUIRES_HUMAN_APPROVAL" },
    { name: "split thread", overrides: { content: { text: longText }, overflowPolicy: "THREAD" }, reason: "THREAD_REQUIRES_HUMAN_APPROVAL" },
    { name: "split thread with follow-up", overrides: { content: { text: longText }, overflowPolicy: "THREAD", followUps: followUps() }, reason: "THREAD_REQUIRES_HUMAN_APPROVAL" },
    { name: "split-thread fallback", overrides: { content: { text: longText }, overflowPolicy: "LONGFORM_THEN_THREAD" }, reason: "THREAD_REQUIRES_HUMAN_APPROVAL" },
    { name: "follow-up URL", overrides: { followUps: followUps("See https://example.com") }, reason: "URL_REQUIRES_HUMAN_APPROVAL" },
    { name: "follow-up mention", overrides: { followUps: followUps("Hello @example") }, reason: "MENTION_REQUIRES_HUMAN_APPROVAL" }
  ])("still requires approval for $name", async ({ overrides, reason }) => {
    const ai = client("ai", "AI");
    const { service } = makeService({ clients: [ai], permissions: [permission(ai.id, 4)] });
    const created = await service.create(baseRequest(overrides), ai, "idem-create", requestMeta());
    expect(created.body).toMatchObject({
      publication: { status: "PENDING_APPROVAL" },
      policy: { decision: "REQUIRE_APPROVAL" }
    });
    expect((created.body as { policy: { reasons: string[] } }).policy.reasons).toContain(reason);
  });

  it.each(["UNKNOWN", "DISABLED"] as const)("still requires approval when longform capability is %s", async (longformCapability) => {
    const ai = client("ai", "AI");
    const { service } = makeService({
      clients: [ai],
      permissions: [permission(ai.id, 4)],
      accounts: [account({ longformCapability })]
    });
    const created = await service.create(extendedRequest(), ai, "idem-create", requestMeta());
    expect(created.body).toMatchObject({
      publication: { status: "PENDING_APPROVAL" },
      policy: { reasons: ["LONGFORM_CAPABILITY_NOT_ENABLED"] }
    });
  });

  it.each(["UNVERIFIED", "DISABLED"] as const)("denies follow-ups when self-reply capability is %s", async (selfReplyCapability) => {
    const ai = client("ai", "AI");
    const { service } = makeService({ clients: [ai], permissions: [permission(ai.id, 4)], accounts: [account({ selfReplyCapability })] });
    await expect(service.create(extendedRequest(), ai, "idem-create", requestMeta())).rejects.toMatchObject({
      code: "POLICY_DENIED", details: { reasons: ["SELF_REPLY_CAPABILITY_REQUIRED"] }
    });
  });

  it.each([
    { content: { text: "\u5fc5\u305a\u5408\u683c" } },
    { followUps: followUps("\u5fc5\u305a\u5408\u683c") }
  ])("denies prohibited patterns in all automatically published texts", async (overrides) => {
    const ai = client("ai", "AI");
    const { service } = makeService({ clients: [ai], permissions: [permission(ai.id, 4)] });
    await expect(service.create(baseRequest(overrides), ai, "idem-create", requestMeta())).rejects.toMatchObject({
      code: "POLICY_DENIED", details: { reasons: ["PROHIBITED_PATTERN"] }
    });
  });

  it("keeps configured posting hours enforced", async () => {
    const ai = client("ai", "AI");
    const { service } = makeService({ clients: [ai], permissions: [{ ...permission(ai.id, 4), allowedHours: [0] }] });
    const created = await service.create(extendedRequest(), ai, "idem-create", requestMeta());
    expect(created.body).toMatchObject({
      publication: { status: "PENDING_APPROVAL" },
      policy: { reasons: ["OUTSIDE_ALLOWED_HOURS_REQUIRES_HUMAN_APPROVAL"] }
    });
  });

  it("does not automatically schedule existing pending items after a permission upgrade", async () => {
    const ai = client("ai", "AI");
    const accountPermission = permission(ai.id, 3);
    const { service, repository, clock } = makeService({ clients: [ai], permissions: [accountPermission] });
    const created = await service.create(extendedRequest(), ai, "idem-create", requestMeta());
    const id = (created.body as { publication: { id: string } }).publication.id;
    accountPermission.permissionLevel = 4;
    clock.set(Date.parse(scheduledAt));
    expect(await repository.claimDuePublications(clock.nowMs(), 120_000, 10)).toEqual([]);
    expect((await repository.getPublicationBundle(id))?.publication.status).toBe("PENDING_APPROVAL");
  });

  it("re-evaluates edited pending items using level 4", async () => {
    const ai = client("ai", "AI");
    const accountPermission = permission(ai.id, 3);
    const { service } = makeService({ clients: [ai], permissions: [accountPermission] });
    const created = await service.create(extendedRequest(), ai, "idem-create", requestMeta());
    const id = (created.body as { publication: { id: string } }).publication.id;
    accountPermission.permissionLevel = 4;
    const patched = await service.patch(id, { memo: { updated: true } }, ai, "idem-patch", requestMeta(`/v1/publications/${id}`));
    expect(patched.body).toMatchObject({ publication: { status: "SCHEDULED", revision: 2 }, policy: { decision: "ALLOW", reasons: [] } });
  });

  it("allows level 4 SERVICE clients to submit an extended draft", async () => {
    const serviceClient = client("svc", "SERVICE");
    const accountPermission = permission(serviceClient.id, 1);
    const { service } = makeService({ clients: [serviceClient], permissions: [accountPermission] });
    const created = await service.create(extendedRequest(), serviceClient, "idem-create", requestMeta());
    const id = (created.body as { publication: { id: string } }).publication.id;
    accountPermission.permissionLevel = 4;
    const submitted = await service.submit(id, serviceClient, "idem-submit", requestMeta(`/v1/publications/${id}/submit`));
    expect(submitted.body).toMatchObject({ publication: { status: "SCHEDULED" }, policy: { decision: "ALLOW" } });
  });

  it("does not give level 4 AI clients human approval authority", async () => {
    const ai = client("ai", "AI");
    const { service } = makeService({ clients: [ai], permissions: [permission(ai.id, 4)] });
    const created = await service.create(baseRequest({ approvalPreference: "REQUIRE_APPROVAL" }), ai, "idem-create", requestMeta());
    const publication = (created.body as { publication: { id: string; revision: number; contentHash: string } }).publication;
    await expect(service.approve(publication.id, publication, ai, "idem-approve", requestMeta())).rejects.toMatchObject({ httpStatus: 403 });
    await expect(service.submit(publication.id, ai, "idem-submit", requestMeta())).rejects.toMatchObject({ httpStatus: 403 });
  });
});
