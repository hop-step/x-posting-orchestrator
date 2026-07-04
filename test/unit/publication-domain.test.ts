import { describe, expect, it } from "vitest";
import { sha256Canonical } from "../../src/shared/crypto";
import { AppError } from "../../src/shared/errors";
import { contentHashForApproval } from "../../src/domain/publications/canonical-hash";
import { buildPublicationPlans } from "../../src/domain/publications/planner";
import { parsePublicationRequest } from "../../src/domain/publications/schemas";
import { splitIntoThread } from "../../src/domain/publications/splitter";
import { weightedLength } from "../../src/domain/publications/weighted-text";
import { account, baseRequest, nowMs, testConfig } from "../helpers/publication-fixtures";

describe("publication domain", () => {
  it("keeps canonical JSON hashes stable regardless of key order", async () => {
    await expect(sha256Canonical({ b: 1, a: { d: 2, c: 3 } })).resolves.toBe(
      await sha256Canonical({ a: { c: 3, d: 2 }, b: 1 })
    );
  });

  it("changes contentHash when schedule or account changes", async () => {
    const request = parsePublicationRequest(baseRequest(), nowMs, testConfig);
    const plans = await buildPublicationPlans({ request, account: account(), nowMs, config: testConfig });
    const base = await contentHashForApproval({ xAccountId: "acc_1", scheduledAtMs: request.scheduledAtMs, request, revision: 1, plans });
    const scheduleChanged = await contentHashForApproval({
      xAccountId: "acc_1",
      scheduledAtMs: request.scheduledAtMs + 1000,
      request: { ...request, scheduledAtMs: request.scheduledAtMs + 1000 },
      revision: 1,
      plans
    });
    const accountChanged = await contentHashForApproval({ xAccountId: "acc_2", scheduledAtMs: request.scheduledAtMs, request, revision: 1, plans });
    expect(scheduleChanged).not.toBe(base);
    expect(accountChanged).not.toBe(base);
  });

  it("stores operational memo without changing the approval content hash", async () => {
    const request = parsePublicationRequest(baseRequest({ memo: { qa_id: "R7_2_396", source: "daily" } }), nowMs, testConfig);
    const requestWithDifferentMemo = parsePublicationRequest(baseRequest({ memo: { qa_id: "R7_2_397", source: "daily" } }), nowMs, testConfig);
    expect(request.memo).toEqual({ qa_id: "R7_2_396", source: "daily" });
    const plans = await buildPublicationPlans({ request, account: account(), nowMs, config: testConfig });
    const plansWithDifferentMemo = await buildPublicationPlans({ request: requestWithDifferentMemo, account: account(), nowMs, config: testConfig });
    const hash = await contentHashForApproval({ xAccountId: "acc_1", scheduledAtMs: request.scheduledAtMs, request, revision: 1, plans });
    const hashWithDifferentMemo = await contentHashForApproval({
      xAccountId: "acc_1",
      scheduledAtMs: requestWithDifferentMemo.scheduledAtMs,
      request: requestWithDifferentMemo,
      revision: 1,
      plans: plansWithDifferentMemo
    });
    expect(hashWithDifferentMemo).toBe(hash);
  });

  it("includes external reply target in normalized request and approval hash", async () => {
    const request = parsePublicationRequest(baseRequest({ replyToPostId: "2072314870444540211" }), nowMs, testConfig);
    expect(request.replyToPostId).toBe("2072314870444540211");
    const plans = await buildPublicationPlans({ request, account: account(), nowMs, config: testConfig });
    const withReply = await contentHashForApproval({ xAccountId: "acc_1", scheduledAtMs: request.scheduledAtMs, request, revision: 1, plans });
    const withoutReplyRequest = parsePublicationRequest(baseRequest(), nowMs, testConfig);
    const withoutReplyPlans = await buildPublicationPlans({ request: withoutReplyRequest, account: account(), nowMs, config: testConfig });
    const withoutReply = await contentHashForApproval({
      xAccountId: "acc_1",
      scheduledAtMs: withoutReplyRequest.scheduledAtMs,
      request: withoutReplyRequest,
      revision: 1,
      plans: withoutReplyPlans
    });
    expect(withReply).not.toBe(withoutReply);
    expect(() => parsePublicationRequest(baseRequest({ replyToPostId: "not-a-post-id" }), nowMs, testConfig)).toThrow(AppError);
  });

  it("counts Japanese, emoji, and URLs with twitter-text rules", () => {
    expect(weightedLength("あ")).toBe(2);
    expect(weightedLength("😀")).toBe(2);
    expect(weightedLength("https://example.com/some/very/long/path")).toBeLessThan(40);
  });

  it("does not split URLs or grapheme clusters and keeps numbered parts within 280", () => {
    const text = `これは長い本文です。https://example.com/really/long/path?query=1 ${"😀".repeat(160)}`;
    const parts = splitIntoThread(text, { numbering: true, maxParts: 10 });
    expect(parts.every((part) => weightedLength(part) <= 280)).toBe(true);
    expect(parts.join("\n")).toContain("https://example.com/really/long/path?query=1");
    expect(parts.join("").replace(/\n\n\(\d+\/\d+\)/g, "")).toContain("😀");
  });

  it("rejects maxParts overflow", () => {
    expect(() => splitIntoThread("あ".repeat(700), { numbering: true, maxParts: 2 })).toThrow(AppError);
  });

  it("rejects IMAGE + POLL and overlong poll text", async () => {
    const imagePoll = parsePublicationRequest(
      baseRequest({
        kind: "POLL",
        content: { text: "poll", mediaIds: ["media_1"], poll: { options: ["a", "b"], durationMinutes: 60 } }
      }),
      nowMs,
      testConfig
    );
    await expect(buildPublicationPlans({ request: imagePoll, account: account(), nowMs, config: testConfig })).rejects.toThrow(AppError);

    const overlongPoll = parsePublicationRequest(
      baseRequest({
        kind: "POLL",
        content: { text: "あ".repeat(141), poll: { options: ["a", "b"], durationMinutes: 60 } }
      }),
      nowMs,
      testConfig
    );
    await expect(buildPublicationPlans({ request: overlongPoll, account: account(), nowMs, config: testConfig })).rejects.toThrow(AppError);
  });

  it("rejects naive datetime and normalizes +09:00 to UTC", () => {
    expect(() => parsePublicationRequest(baseRequest({ scheduledAt: "2026-06-22T12:00:00" }), nowMs, testConfig)).toThrow(AppError);
    const request = parsePublicationRequest(baseRequest({ scheduledAt: "2026-06-22T12:00:00+09:00" }), nowMs, testConfig);
    expect(new Date(request.scheduledAtMs).toISOString()).toBe("2026-06-22T03:00:00.000Z");
  });

  it("rejects threads and poll replies when self-reply capability is unverified", async () => {
    const threadRequest = parsePublicationRequest(
      baseRequest({ content: { text: "あ".repeat(200) }, overflowPolicy: "THREAD", threadOptions: { maxParts: 10, numbering: true, mediaPlacement: "FIRST" } }),
      nowMs,
      testConfig
    );
    await expect(
      buildPublicationPlans({ request: threadRequest, account: account({ selfReplyCapability: "UNVERIFIED" }), nowMs, config: testConfig })
    ).rejects.toThrow(AppError);
  });
});
