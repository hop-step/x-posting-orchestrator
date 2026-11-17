import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { describe, expect, it, vi } from "vitest";
import { unstable_splitSqlQuery } from "wrangler";
import { readPublicationHistory } from "../../scripts/read-publication-history";
import { digestApiKey } from "../../src/domain/auth/api-keys";
import type { PreviewResult, PublicationBundle } from "../../src/domain/publications/entities";
import type { Env } from "../../src/env";
import { createApp } from "../../src/http/app";
import { D1AppRepository } from "../../src/infrastructure/d1/repositories/app-repository";
import { FakeXAdapter } from "../../src/infrastructure/x/fake-x-adapter";
import { FixedClock, systemClock } from "../../src/shared/clock";
import type { PublishQueueMessage } from "../../src/workers/messages";
import legacyFixture from "../fixtures/x-v1-poll.json";
import { testConfig } from "../helpers/publication-fixtures";
import { publishXQueueMessage } from "../helpers/x-publication-publisher";

// Captured from 83ae59e with a fixed clock and a fake X client, before introducing the ports.
const legacy = legacyFixture as {
  request: typeof legacyFixture.request;
  previewHash: string;
  queued: PublicationBundle;
  message: PublishQueueMessage;
  awaitingReply: { publication: Partial<PublicationBundle["publication"]>; steps: PublicationBundle["plans"][number]["steps"] };
};
const apiKey = `xps_fixture_ai.${"a".repeat(32)}`;
const pepper = "fixture-pepper";
const baseUrl = "https://x-adapter-test.example";
const previewTime = legacy.queued.publication.createdAtMs;

describe("X v1 compatibility across the adapter boundary", () => {
  it("keeps the preview hash, create response, account list, and weekly history contract", async () => {
    await withLocalD1(async ({ repository, env }) => {
      await repository.createPublicationBundle(legacy.queued);
      const app = createApp("# Fixture docs");
      const clock = vi.spyOn(systemClock, "nowMs").mockReturnValue(previewTime);
      const headers = { Authorization: `Bearer ${apiKey}` };
      try {
        const accounts = await app.request("/v1/x/accounts", { headers }, env);
        expect(accounts.status).toBe(200);
        expect(await accounts.json()).toMatchObject({ accounts: [{ id: "acc_1" }] });
        const preview = await app.request("/v1/publications/preview", {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(legacy.request)
        }, env);
        expect(preview.status).toBe(200);
        const previewBody = await preview.json<PreviewResult>();
        expect(previewBody.contentHash).toBe(legacy.previewHash);
        expect(previewBody.policy.decision).toBe("REQUIRE_APPROVAL");
        expect(previewBody.policy.reasons).toEqual(legacy.queued.publication.policyReasons);
        expect(previewBody.plans.map((plan) => plan.planHash)).toEqual(legacy.queued.plans.map((plan) => plan.planHash));
        expect(previewBody.estimate).toEqual({ postCreateRequests: 2, mediaUploads: 0, threadParts: 1 });

        const create = () => app.request("/v1/publications", {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json", "Idempotency-Key": "fixture-create-v1" },
          body: JSON.stringify(legacy.request)
        }, env);
        const created = await create();
        expect(created.status).toBe(201);
        const createdBody: unknown = await created.json();
        expect(createdBody).toMatchObject({
          publication: { status: "PENDING_APPROVAL", revision: 1, contentHash: legacy.previewHash }
        });
        expect(await (await create()).json()).toEqual(createdBody);
        const history = await readPublicationHistory({
          baseUrl,
          apiKey,
          xAccountId: "acc_1",
          nowMs: previewTime,
          fetchPage: async (input, init) => app.request(input, init, env)
        });
        expect(history).toMatchObject({ complete: true, scannedCount: 2 });
        expect(history.publications.find(({ publication }) => publication.id === legacy.message.publicationId)?.publication).toMatchObject({
          status: "QUEUED",
          request: { memo: { qa_id: "fixture_01" } }
        });
      } finally {
        clock.mockRestore();
      }
    });
  });

  it("executes a pre-refactor queue message with its original approval and ignores redelivery", async () => {
    await withLocalD1(async ({ repository }) => {
      await repository.createPublicationBundle(legacy.queued);
      const xClient = new FakeXAdapter();
      const clock = new FixedClock(legacy.message.enqueuedAtMs);
      const params = { repository, xClient, tokenManager: null, mediaBucket: null, clock, config: testConfig };
      await expect(publishXQueueMessage({ ...params, message: { ...legacy.message, leaseToken: "stale-lease" } })).resolves.toBe("NOOP");
      await expect(publishXQueueMessage({ ...params, message: { ...legacy.message, contentHash: "stale-hash" } })).resolves.toBe("NOOP");
      expect(xClient.calls).toEqual([]);
      await expect(publishXQueueMessage({ ...params, message: legacy.message })).resolves.toBe("PUBLISHED");
      await expect(publishXQueueMessage({ ...params, message: legacy.message })).resolves.toBe("NOOP");
      expect(xClient.calls).toHaveLength(1);
      expect(xClient.calls[0]).toMatchObject({ text: "Fixture question", poll: legacy.request.content.poll, replyToPostId: null });
      const stored = await repository.getPublicationBundle(legacy.message.publicationId);
      expect(stored?.publication).toMatchObject({
        ...legacy.awaitingReply.publication,
        revision: legacy.message.revision,
        contentHash: legacy.message.contentHash,
        activeApprovalId: legacy.queued.publication.activeApprovalId
      });
      expect(stored?.approvals).toEqual(legacy.queued.approvals);
    });
  });

  it("resumes only the reply of an old publication whose root was already sent", async () => {
    await withLocalD1(async ({ repository }) => {
      const [rootPlan] = legacy.queued.plans;
      if (rootPlan === undefined) throw new Error("Legacy fixture is missing its plan.");
      await repository.createPublicationBundle({
        ...legacy.queued,
        publication: { ...legacy.queued.publication, ...legacy.awaitingReply.publication },
        plans: [{ ...rootPlan, steps: legacy.awaitingReply.steps }]
      });
      const dueAt = legacy.awaitingReply.publication.nextActionAtMs;
      if (dueAt === undefined || dueAt === null) throw new Error("Legacy fixture is missing the reply time.");
      expect(await repository.claimDuePublications(dueAt - 1, 120_000, 1)).toEqual([]);
      const [message] = await repository.claimDuePublications(dueAt, 120_000, 1);
      if (message === undefined) throw new Error("No follow-up claimed.");
      expect(message).toMatchObject({ version: 1, reason: "FOLLOW_UP", contentHash: legacy.message.contentHash });
      const xClient = new FakeXAdapter([{ type: "SUCCESS", xPostId: "0000000002", text: "Fixture explanation" }]);
      await expect(publishXQueueMessage({
        repository, xClient, tokenManager: null, mediaBucket: null, clock: new FixedClock(dueAt), config: testConfig, message
      })).resolves.toBe("PUBLISHED");
      expect(xClient.calls).toHaveLength(1);
      expect(xClient.calls[0]).toMatchObject({ text: "Fixture explanation", replyToPostId: "0000000001", poll: null });
      const bundle = await repository.getPublicationBundle(message.publicationId);
      expect(bundle?.publication.status).toBe("PUBLISHED");
      expect(bundle?.plans[0]?.steps.map((step) => step.xPostId)).toEqual(["0000000001", "0000000002"]);
    });
  });
});

async function withLocalD1(check: (local: { repository: D1AppRepository; env: Env }) => Promise<void>): Promise<void> {
  const runtime = new Miniflare({ modules: true, script: "export default {}", d1Databases: ["DB"], d1Persist: false });
  try {
    const db = await runtime.getD1Database("DB");
    for (const migration of ["0001_initial.sql", "0002_admin_read_indexes.sql", "0003_scheduler_due_index.sql", "0004_publication_list_cursor.sql"]) {
      const sql = readFileSync(new URL(`../../migrations/${migration}`, import.meta.url), "utf8");
      await db.batch(unstable_splitSqlQuery(sql).map((statement) => db.prepare(statement)));
    }
    await db.batch([
      db.prepare(`INSERT INTO api_clients
        (id, name, actor_type, key_prefix, key_digest, status, scopes_json, created_at_ms, updated_at_ms)
        VALUES ('fixture_ai', 'Fixture AI', 'AI', 'xps_fixture_ai', ?, 'ACTIVE', ?, ?, ?)`)
        .bind(await digestApiKey(pepper, apiKey), JSON.stringify(["account:read", "publication:read", "publication:preview", "publication:create"]), previewTime, previewTime),
      db.prepare(`INSERT INTO x_accounts
        (id, name, x_user_id, x_username, status, longform_capability, self_reply_capability, created_at_ms, updated_at_ms)
        VALUES ('acc_1', 'Fixture X account', '100', 'fixture', 'ACTIVE', 'ENABLED', 'ENABLED', ?, ?)`).bind(previewTime, previewTime),
      db.prepare(`INSERT INTO client_account_permissions
        (client_id, x_account_id, permission_level, created_at_ms, updated_at_ms)
        VALUES ('fixture_ai', 'acc_1', 2, ?, ?)`).bind(previewTime, previewTime)
    ]);
    await check({
      repository: new D1AppRepository(db),
      env: { DB: db, PUBLISH_QUEUE: {} as Queue<never>, API_KEY_PEPPER: pepper, PUBLIC_BASE_URL: baseUrl }
    });
  } finally {
    await runtime.dispose();
  }
}
