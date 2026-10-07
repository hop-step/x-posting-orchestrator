import { describe, expect, it } from "vitest";
import type { PublicationRepository } from "../../src/application/repository";
import type { Env } from "../../src/env";
import {
  buildDiscordApprovalPayload,
  buildDiscordPublicationFailurePayload,
  sendDiscordApprovalNotification,
  sendDiscordPublicationFailureNotification,
  verifyDiscordRequestSignature
} from "../../src/infrastructure/discord/approval-notifier";
import type { PublicationBundle } from "../../src/domain/publications/entities";

describe("Discord approval notifier", () => {
  it("builds compact approval messages with only the admin link", () => {
    const bundle = publicationBundle();
    const payload = buildDiscordApprovalPayload(bundle, "https://example.com/");

    expect(payload.content).toContain("承認待ち");
    expect(payload.embeds[0]?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Publication ID", value: "pub_1" }),
        expect.objectContaining({ name: "画像", value: "1枚" }),
        expect.objectContaining({ name: "memo", value: "qa_id: R7_2_396" })
      ])
    );
    expect(payload.components[0]?.components).toEqual([
      expect.objectContaining({ label: "管理画面", url: "https://example.com/admin" })
    ]);
    expect(JSON.stringify(payload)).not.toContain("custom_id");
  });

  it("skips notification without a Discord webhook URL", async () => {
    const repository = {
      getPublicationBundle: async () => {
        throw new Error("repository should not be read when webhook is disabled");
      }
    } as unknown as PublicationRepository;

    await expect(
      sendDiscordApprovalNotification({
        env: env({ DISCORD_APPROVAL_WEBHOOK_URL: "" }),
        repository,
        publicationId: "pub_1"
      })
    ).resolves.toEqual({ status: "SKIPPED", reason: "DISCORD_APPROVAL_DESTINATION_MISSING" });
  });

  it("sends approval messages to a Discord bot channel when configured", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const repository = {
      getPublicationBundle: async () => publicationBundle(),
      recordAuditLog: async () => {}
    } as unknown as PublicationRepository;
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls.push({ url: requestUrl(input), init: init ?? {} });
      return new Response("{}", { status: 200 });
    };

    await expect(
      sendDiscordApprovalNotification({
        env: env({
          DISCORD_BOT_TOKEN: "bot_secret",
          DISCORD_APPROVAL_CHANNEL_ID: "1234567890"
        }),
        repository,
        publicationId: "pub_1",
        fetcher
      })
    ).resolves.toMatchObject({ status: "SENT", httpStatus: 200 });

    expect(calls[0]?.url).toBe("https://discord.com/api/v10/channels/1234567890/messages");
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe("Bot bot_secret");
    const body = calls[0]?.init.body;
    if (typeof body !== "string") {
      throw new Error("Expected JSON string body.");
    }
    expect(body).toContain("https://example.com/admin");
    expect(body).not.toContain("custom_id");
  });

  it("builds publication failure messages without retry actions", () => {
    const payload = buildDiscordPublicationFailurePayload(deliveryUnknownBundle(), "https://example.com/");

    expect(payload.content).toContain("送信結果が不明");
    expect(payload.embeds[0]?.title).toContain("送信結果が不明");
    expect(payload.embeds[0]?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Publication ID", value: "pub_1" }),
        expect.objectContaining({ name: "Failure Code", value: "X_HTTP_503" }),
        expect.objectContaining({ name: "memo", value: "qa_id: R7_2_396" })
      ])
    );
    const fields = payload.embeds[0]?.fields ?? [];
    expect(fields.some((field) => field.name === "失敗Step" && field.value.includes("Step 2 FOLLOW_UP"))).toBe(true);
    expect(fields.some((field) => field.name === "X投稿ID" && field.value.includes("post_root"))).toBe(true);
    expect(payload.components[0]?.components).toEqual([expect.objectContaining({ label: "管理画面", url: "https://example.com/admin" })]);
    expect(JSON.stringify(payload)).not.toContain("承認");
  });

  it("sends publication failure messages to the configured Discord bot channel", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const auditLogs: Array<{ eventType: string; metadata: Record<string, unknown> }> = [];
    const repository = {
      getPublicationBundle: async () => deliveryUnknownBundle(),
      recordAuditLog: async (input: { eventType: string; metadata: Record<string, unknown> }) => {
        auditLogs.push(input);
      }
    } as unknown as PublicationRepository;
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls.push({ url: requestUrl(input), init: init ?? {} });
      return new Response("{}", { status: 200 });
    };

    await expect(
      sendDiscordPublicationFailureNotification({
        env: env({
          DISCORD_BOT_TOKEN: "bot_secret",
          DISCORD_APPROVAL_CHANNEL_ID: "approval-channel"
        }),
        repository,
        publicationId: "pub_1",
        status: "DELIVERY_UNKNOWN",
        fetcher
      })
    ).resolves.toMatchObject({ status: "SENT", httpStatus: 200 });

    expect(calls[0]?.url).toBe("https://discord.com/api/v10/channels/approval-channel/messages");
    const body = calls[0]?.init.body;
    if (typeof body !== "string") {
      throw new Error("Expected JSON string body.");
    }
    expect(body).toContain("X_HTTP_503");
    expect(auditLogs[0]?.eventType).toBe("DISCORD_PUBLICATION_FAILURE_NOTIFICATION_SENT");
    expect(auditLogs[0]?.metadata.status).toBe("DELIVERY_UNKNOWN");
  });

  it("rejects malformed Discord signatures", async () => {
    await expect(
      verifyDiscordRequestSignature({
        publicKeyHex: "00",
        signatureHex: "00",
        timestamp: "123",
        body: "{}"
      })
    ).resolves.toBe(false);
  });

});

function env(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    PUBLISH_QUEUE: {} as Queue<never>,
    API_KEY_PEPPER: "pepper",
    PUBLIC_BASE_URL: "https://example.com",
    ALLOWED_CORS_ORIGINS: "",
    ...overrides
  };
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function publicationBundle(): PublicationBundle {
  return {
    publication: {
      id: "pub_1",
      xAccountId: "acc_1",
      createdByClientId: "client_ai",
      status: "PENDING_APPROVAL",
      kind: "IMAGE",
      revision: 2,
      contentHash: "hash_1",
      request: {
        xAccountId: "acc_1",
        scheduledAt: "2026-07-20T09:00:00+09:00",
        scheduledAtMs: Date.parse("2026-07-20T00:00:00.000Z"),
        replyToPostId: null,
        kind: "IMAGE",
        content: {
          text: "画像つき投稿です。",
          mediaIds: ["media_1"],
          poll: null,
          madeWithAi: false
        },
        overflowPolicy: "REJECT",
        threadOptions: {
          numbering: true,
          maxParts: 10,
          mediaPlacement: "FIRST"
        },
        followUps: [
          {
            trigger: {
              type: "AFTER_PARENT_PUBLISHED",
              offsetMinutes: 5
            },
            content: {
              text: "返信です。"
            }
          }
        ],
        approvalPreference: "POLICY",
        memo: {
          qa_id: "R7_2_396"
        }
      },
      overflowPolicy: "REJECT",
      approvalPreference: "POLICY",
      policyId: null,
      policyVersion: null,
      policyDecision: "REQUIRE_APPROVAL",
      policyReasons: ["IMAGE_REQUIRES_APPROVAL"],
      approvalRequired: true,
      activeApprovalId: null,
      activePlanId: "plan_1",
      scheduledAtMs: Date.parse("2026-07-20T00:00:00.000Z"),
      nextActionAtMs: null,
      leaseToken: null,
      leaseUntilMs: null,
      rootPublishedAtMs: null,
      completedAtMs: null,
      failureCode: null,
      failure: null,
      createdAtMs: 1,
      updatedAtMs: 2
    },
    plans: [
      {
        id: "plan_1",
        kind: "PRIMARY",
        strategy: "STANDARD_SINGLE",
        steps: [],
        capabilityRequirements: {
          longform: null,
          selfReply: null
        },
        planHash: "plan_hash",
        isActive: true,
        createdAtMs: 1
      }
    ],
    approvals: []
  };
}

function deliveryUnknownBundle(): PublicationBundle {
  const bundle = publicationBundle();
  return {
    ...bundle,
    publication: {
      ...bundle.publication,
      status: "DELIVERY_UNKNOWN",
      failureCode: "X_HTTP_503",
      failure: {
        title: "Service Unavailable",
        status: 503
      },
      rootPublishedAtMs: Date.parse("2026-07-20T00:00:37.000Z"),
      updatedAtMs: Date.parse("2026-07-20T00:06:40.000Z")
    },
    plans: [
      {
        ...(bundle.plans[0] as PublicationBundle["plans"][number]),
        steps: [
          {
            id: "step_root",
            sequence: 1,
            stepType: "MAIN",
            relation: "ROOT",
            replyToStepId: null,
            triggerType: "AT_PUBLICATION_TIME",
            triggerOffsetMinutes: 0,
            resolvedDueAtMs: Date.parse("2026-07-20T00:00:00.000Z"),
            text: "画像つき投稿です。",
            poll: null,
            mediaIds: ["media_1"],
            weightedLength: 9,
            madeWithAi: false,
            status: "PUBLISHED",
            attemptCount: 1,
            xPostId: "post_root",
            publishedAtMs: Date.parse("2026-07-20T00:00:37.000Z"),
            nextAttemptAtMs: null,
            lastErrorCode: null,
            lastError: null
          },
          {
            id: "step_follow",
            sequence: 2,
            stepType: "FOLLOW_UP",
            relation: "REPLY_STEP",
            replyToStepId: "step_root",
            triggerType: "AFTER_PARENT_PUBLISHED",
            triggerOffsetMinutes: 5,
            resolvedDueAtMs: Date.parse("2026-07-20T00:05:37.000Z"),
            text: "返信です。",
            poll: null,
            mediaIds: [],
            weightedLength: 5,
            madeWithAi: false,
            status: "DELIVERY_UNKNOWN",
            attemptCount: 1,
            xPostId: null,
            publishedAtMs: null,
            nextAttemptAtMs: null,
            lastErrorCode: "X_HTTP_503",
            lastError: {
              title: "Service Unavailable",
              status: 503
            }
          }
        ]
      }
    ]
  };
}
