import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { describe, expect, it } from "vitest";
import { unstable_splitSqlQuery } from "wrangler";
import { readPublicationHistory } from "../../scripts/read-publication-history";
import { digestApiKey } from "../../src/domain/auth/api-keys";
import type { PublicationBundle } from "../../src/domain/publications/entities";
import type { Env } from "../../src/env";
import { createApp } from "../../src/http/app";
import { encodePublicationListCursor } from "../../src/http/publication-list-cursor";

const nowMs = Date.UTC(2026, 10, 9);
const apiKey = `xps_fixture.${"a".repeat(32)}`;
const pepper = "local-test-pepper";
const baseUrl = "https://publication-list.example.test";
type Page = { publications: PublicationBundle[]; nextCursor: string | null };

describe("publication pagination on local D1", () => {
  it("walks 221 tied rows across pages, preserves permissions, and seeks with the account index", async () => {
    const runtime = new Miniflare({ modules: true, script: "export default {}", d1Databases: ["DB"], d1Persist: false });
    try {
      const db = await runtime.getD1Database("DB");
      for (const name of ["0001_initial.sql", "0002_admin_read_indexes.sql", "0003_scheduler_due_index.sql"]) {
        await applyMigration(db, name);
      }
      await db.batch([
        db.prepare(`INSERT INTO api_clients
          (id, name, actor_type, key_prefix, key_digest, status, scopes_json, created_at_ms, updated_at_ms)
          VALUES ('reader', 'Reader', 'AI', 'xps_fixture', ?, 'ACTIVE', '["publication:read"]', ?, ?)`)
          .bind(await digestApiKey(pepper, apiKey), nowMs, nowMs),
        db.prepare(`INSERT INTO client_account_permissions
          (client_id, x_account_id, permission_level, created_at_ms, updated_at_ms)
          VALUES ('reader', 'acc_1', 2, ?, ?), ('reader', 'acc_denied', 0, ?, ?), ('reader', 'acc_other', 2, ?, ?)`)
          .bind(nowMs, nowMs, nowMs, nowMs, nowMs, nowMs),
        db.prepare(`WITH RECURSIVE numbers(n) AS (VALUES(1) UNION ALL SELECT n + 1 FROM numbers WHERE n < 223)
          INSERT INTO publications
            (id, x_account_id, created_by_client_id, status, kind, revision, content_hash, request_json,
             overflow_policy, approval_preference, policy_decision, policy_reasons_json, approval_required,
             scheduled_at_ms, created_at_ms, updated_at_ms)
          SELECT printf('pub_%04d', n), CASE n WHEN 222 THEN 'acc_denied' WHEN 223 THEN 'acc_other' ELSE 'acc_1' END,
                 'creator', CASE n WHEN 1 THEN 'PENDING_APPROVAL' WHEN 2 THEN 'SCHEDULED' ELSE 'PUBLISHED' END,
                 'TEXT', 1, 'fixture', '{"content":{"text":"Fixture question"},"memo":{"qa_id":"fixture"}}',
                 'REJECT', 'POLICY', 'ALLOW', '[]', 0, ?, ?, ?
          FROM numbers`).bind(nowMs, nowMs, nowMs)
      ]);

      let candidateSql = "";
      const database = new Proxy(db, {
        get(target, key): unknown {
          if (key === "prepare") {
            return (sql: string) => {
              if (sql.startsWith("SELECT p.id, p.created_at_ms")) candidateSql = sql;
              return target.prepare(sql);
            };
          }
          return Reflect.get(target, key, target);
        }
      });
      const env: Env = { DB: database, PUBLISH_QUEUE: {} as Queue<never>, API_KEY_PEPPER: pepper, PUBLIC_BASE_URL: baseUrl };
      const app = createApp("# Test");
      const get = (path: string) => app.request(path, { headers: { Authorization: `Bearer ${apiKey}` } }, env);
      const path = "/v1/publications?limit=200&xAccountId=acc_1";
      const cursor = encodePublicationListCursor({ createdAtMs: nowMs, id: "pub_0222" });
      expect((await get(`${path}&cursor=${cursor}`)).status).toBe(200);
      expect(candidateSql).toContain("(p.created_at_ms, p.id) < (?, ?)");
      const binds = ["reader", "acc_1", nowMs, "pub_0222", 101] as const;
      const baseline = await db.prepare(candidateSql).bind(...binds).all();
      await applyMigration(db, "0004_publication_list_cursor.sql");
      const optimized = await db.prepare(candidateSql).bind(...binds).all();
      const plan = await db.prepare(`EXPLAIN QUERY PLAN ${candidateSql}`).bind(...binds).all<{ detail: string }>();
      expect(optimized.results).toEqual(baseline.results);
      expect(optimized.meta.rows_read).toBeLessThan(baseline.meta.rows_read);
      expect(optimized.meta.rows_read).toBeLessThanOrEqual(105);
      expect(plan.results.some((row) => row.detail.includes("COVERING INDEX idx_publications_account_created_id"))).toBe(true);
      expect(plan.results.some((row) => row.detail.includes("TEMP B-TREE"))).toBe(false);

      const ids: string[] = [];
      const counts: number[] = [];
      let nextCursor: string | null = null;
      for (let pageIndex = 0; pageIndex < 3; pageIndex += 1) {
        const response = await get(nextCursor === null ? path : `${path}&cursor=${nextCursor}`);
        expect(response.status).toBe(200);
        const page = await response.json<Page>();
        counts.push(page.publications.length);
        ids.push(...page.publications.map((bundle) => bundle.publication.id));
        nextCursor = page.nextCursor;
      }
      expect(counts).toEqual([100, 100, 21]);
      expect(ids).toEqual(Array.from({ length: 221 }, (_, i) => `pub_${String(221 - i).padStart(4, "0")}`));
      expect(nextCursor).toBeNull();

      const posted = await get(`${path}&statusGroups=posted&cursor=${encodePublicationListCursor({ createdAtMs: nowMs, id: "pub_0005" })}`);
      expect((await posted.json<Page>()).publications.map((bundle) => bundle.publication.id)).toEqual(["pub_0004", "pub_0003"]);
      expect((await get("/v1/publications?xAccountId=acc_denied")).status).toBe(404);
      expect((await get(`${path}&cursor=invalid`)).status).toBe(400);
      const unscoped = await (await get("/v1/publications?limit=2")).json<Page>();
      expect(unscoped.publications.map((bundle) => bundle.publication.id)).toEqual(["pub_0223", "pub_0221"]);

      const history = await readPublicationHistory({
        baseUrl,
        apiKey,
        xAccountId: "acc_1",
        nowMs,
        fetchPage: async (input, init) => {
          expect(init?.method).toBe("GET");
          return app.request(input, init, env);
        }
      });
      expect(history).toMatchObject({ complete: true, pages: 3, scannedCount: 221 });
      expect(history.publications.map((bundle) => bundle.publication.id)).toEqual(ids);
    } finally {
      await runtime.dispose();
    }
  });
});

async function applyMigration(db: D1Database, name: string): Promise<void> {
  const sql = readFileSync(new URL(`../../migrations/${name}`, import.meta.url), "utf8");
  await db.batch(unstable_splitSqlQuery(sql).map((statement) => db.prepare(statement)));
}
