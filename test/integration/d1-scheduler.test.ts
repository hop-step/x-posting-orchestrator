import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { unstable_splitSqlQuery } from "wrangler";
import type { PublicationStatus } from "../../src/domain/publications/entities";
import { D1AppRepository } from "../../src/infrastructure/d1/repositories/app-repository";

const nowMs = Date.UTC(2026, 0, 1);
const leaseDurationMs = 120_000;
const schedulerMigration = "0003_scheduler_due_index.sql";

describe("D1 scheduler due index", () => {
  let runtime: Miniflare;
  let database: D1Database;
  let repository: D1AppRepository;
  let candidateSql: string;
  let baselineIdleReads: number;

  beforeEach(async () => {
    runtime = new Miniflare({
      modules: true,
      script: "export default {}",
      d1Databases: ["DB"],
      d1Persist: false
    });
    database = await runtime.getD1Database("DB");
    for (const migration of ["0001_initial.sql", "0002_admin_read_indexes.sql"]) {
      await applyMigration(migration);
    }
    await seedMany("history", 10_000, "PUBLISHED", nowMs - 60_000);
    await seedMany("future", 50, "SCHEDULED", nowMs + 3_600_000);

    // Measure the repository's actual SELECT, not a separately maintained query.
    const statements: string[] = [];
    repository = new D1AppRepository(
      new Proxy(database, {
        get(target, key): unknown {
          if (key === "prepare") {
            return (query: string) => {
              statements.push(query);
              return target.prepare(query);
            };
          }
          return Reflect.get(target, key, target);
        }
      })
    );
    expect(await repository.claimDuePublications(nowMs, leaseDurationMs, 25)).toEqual([]);
    candidateSql = statements[0] ?? "";
    expect(candidateSql).toContain("FROM publications");
    baselineIdleReads = (await readCandidates()).meta.rows_read;
    await applyMigration(schedulerMigration);
  });

  afterEach(async () => {
    await runtime.dispose();
  });

  it("reads at most one row on idle ticks regardless of published history", async () => {
    const result = await readCandidates();
    expect(result.results).toEqual([]);
    expect(result.meta.rows_read).toBeLessThanOrEqual(1);
    expect(result.meta.rows_read).toBeLessThan(baselineIdleReads);
    const plan = await database.prepare(`EXPLAIN QUERY PLAN ${candidateSql}`).bind(nowMs, nowMs, 25).all<{ detail: string }>();
    expect(plan.results.some((row) => row.detail.includes("COVERING INDEX idx_publications_pending_due"))).toBe(true);
    expect(plan.results.some((row) => /SCAN publications|TEMP B-TREE/.test(row.detail))).toBe(false);
    const oldIndex = await database.prepare("SELECT name FROM sqlite_schema WHERE name = 'idx_publications_due'").all();
    expect(oldIndex.results).toEqual([]);
  });

  it("keeps due-time, status, lease boundaries, and queue reasons unchanged", async () => {
    await seedOne("scheduled", "SCHEDULED", nowMs - 4_000);
    await seedOne("recovery", "QUEUED", nowMs - 3_000, nowMs - 1);
    await seedOne("follow_up", "AWAITING_FOLLOW_UP", nowMs - 2_000);
    await seedOne("retry", "RETRY_SCHEDULED", nowMs);
    await seedOne("leased", "QUEUED", nowMs - 1_000, nowMs);
    await seedOne("not_due", "SCHEDULED", nowMs + 1);
    await seedOne("no_due_time", "SCHEDULED", null);
    for (const status of ["DRAFT", "PENDING_APPROVAL", "PUBLISHING", "PUBLISHED", "PARTIALLY_PUBLISHED", "FAILED", "DELIVERY_UNKNOWN", "BLOCKED_POLICY", "REJECTED", "CANCELLED"] satisfies PublicationStatus[]) {
      await seedOne(`excluded_${status}`, status, nowMs - 5_000);
    }

    const messages = await repository.claimDuePublications(nowMs, leaseDurationMs, 25);
    expect(messages.map((message) => [message.publicationId, message.reason])).toEqual([
      ["scheduled", "SCHEDULED"],
      ["recovery", "RECOVERY"],
      ["follow_up", "FOLLOW_UP"],
      ["retry", "RETRY"]
    ]);
    for (const message of messages) {
      expect(message).toMatchObject({ version: 1, revision: 1, contentHash: "test-content", enqueuedAtMs: nowMs });
      expect(message.leaseToken).toHaveLength(32);
    }
    const claimed = await database.prepare("SELECT status, lease_until_ms FROM publications WHERE id = 'scheduled'").first();
    expect(claimed).toEqual({ status: "QUEUED", lease_until_ms: nowMs + leaseDurationMs });
  });

  it("prevents duplicate claims and recovers a queued publication only after lease expiry", async () => {
    await seedOne("recoverable", "SCHEDULED", nowMs);
    const initial = await repository.claimDuePublications(nowMs, leaseDurationMs, 1);
    expect(initial).toHaveLength(1);
    expect(await repository.claimDuePublications(nowMs, leaseDurationMs, 1)).toEqual([]);
    expect(await repository.claimDuePublications(nowMs + leaseDurationMs, leaseDurationMs, 1)).toEqual([]);
    const recovered = await repository.claimDuePublications(nowMs + leaseDurationMs + 1, leaseDurationMs, 1);
    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.reason).toBe("RECOVERY");
    expect(recovered[0]?.leaseToken).not.toBe(initial[0]?.leaseToken);
  });

  it("bounds backlog reads while preserving the earliest 25 eligible publications", async () => {
    await seedMany("backlog", 1_000, "mixed", nowMs - 60_000);
    await database.prepare("UPDATE publications SET lease_until_ms = ? WHERE id IN ('backlog_1', 'backlog_2', 'backlog_3')").bind(nowMs + leaseDurationMs).run();
    const optimized = await readCandidates();
    expect(optimized.results.map((row) => row.id)).toEqual(Array.from({ length: 25 }, (_, index) => `backlog_${index + 4}`));
    expect(optimized.meta.rows_read).toBeLessThanOrEqual(30);

    await database.batch([
      database.prepare("DROP INDEX idx_publications_pending_due"),
      database.prepare("CREATE INDEX idx_publications_due ON publications(status, next_action_at_ms)")
    ]);
    const baseline = await readCandidates();
    expect(optimized.results).toEqual(baseline.results);
    expect(optimized.meta.rows_read).toBeLessThan(baseline.meta.rows_read);
    await applyMigration(schedulerMigration);
    expect((await repository.claimDuePublications(nowMs, leaseDurationMs, 25)).map((message) => message.publicationId)).toEqual(
      optimized.results.map((row) => row.id)
    );
  });

  async function applyMigration(name: string): Promise<void> {
    const sql = readFileSync(new URL(`../../migrations/${name}`, import.meta.url), "utf8");
    await database.batch(unstable_splitSqlQuery(sql).map((statement) => database.prepare(statement)));
  }

  function readCandidates(): Promise<D1Result<{ id: string }>> {
    return database.prepare(candidateSql).bind(nowMs, nowMs, 25).all<{ id: string }>();
  }

  async function seedOne(id: string, status: PublicationStatus, dueAtMs: number | null, leaseUntilMs: number | null = null): Promise<void> {
    await database.prepare(
      `INSERT INTO publications
       (id, x_account_id, created_by_client_id, status, kind, revision, content_hash, request_json,
        overflow_policy, approval_preference, policy_decision, policy_reasons_json, approval_required,
        scheduled_at_ms, next_action_at_ms, lease_until_ms, created_at_ms, updated_at_ms)
       VALUES (?, 'test-account', 'test-client', ?, 'STANDARD', 1, 'test-content', '{}',
               'REJECT', 'POLICY', 'ALLOW', '[]', 0, ?, ?, ?, ?, ?)`
    ).bind(id, status, dueAtMs ?? nowMs, dueAtMs, leaseUntilMs, nowMs, nowMs).run();
  }

  async function seedMany(prefix: string, count: number, status: PublicationStatus | "mixed", dueAtMs: number): Promise<void> {
    await database.prepare(
      `WITH RECURSIVE numbers(n) AS (VALUES(1) UNION ALL SELECT n + 1 FROM numbers WHERE n < ?)
       INSERT INTO publications
       (id, x_account_id, created_by_client_id, status, kind, revision, content_hash, request_json,
        overflow_policy, approval_preference, policy_decision, policy_reasons_json, approval_required,
        scheduled_at_ms, next_action_at_ms, created_at_ms, updated_at_ms)
       SELECT ? || '_' || n, 'test-account', 'test-client',
              CASE WHEN ? = 'mixed' THEN CASE n % 4 WHEN 0 THEN 'SCHEDULED' WHEN 1 THEN 'QUEUED'
                   WHEN 2 THEN 'AWAITING_FOLLOW_UP' ELSE 'RETRY_SCHEDULED' END ELSE ? END,
              'STANDARD', 1, 'test-content', '{}', 'REJECT', 'POLICY', 'ALLOW', '[]', 0,
              ? + n, ? + n, ?, ? FROM numbers`
    ).bind(count, prefix, status, status, dueAtMs, dueAtMs, nowMs, nowMs).run();
  }
});
