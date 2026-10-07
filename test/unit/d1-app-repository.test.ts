import { describe, expect, it } from "vitest";
import { D1AppRepository } from "../../src/infrastructure/d1/repositories/app-repository";

describe("D1AppRepository publication listing", () => {
  it("loads all related rows in one batch and preserves list order", async () => {
    let listQueryCount = 0;
    let batchCount = 0;

    class FakeStatement {
      constructor(
        readonly sql: string,
        readonly bindings: unknown[] = []
      ) {}

      bind(...bindings: unknown[]): FakeStatement {
        return new FakeStatement(this.sql, bindings);
      }

      async all<Row>(): Promise<{ results: Row[] }> {
        listQueryCount += 1;
        return { results: [{ id: "pub_2" }, { id: "pub_1" }] as Row[] };
      }
    }

    const database = {
      prepare: (sql: string) => new FakeStatement(sql),
      batch: async (statements: FakeStatement[]) => {
        batchCount += 1;
        expect(statements).toHaveLength(4);
        expect(statements.every((statement) => statement.bindings.length === 2)).toBe(true);
        return statements.map((statement) => ({
          results: statement.sql.includes("FROM publications WHERE")
            ? [publicationRow("pub_1"), publicationRow("pub_2")]
            : []
        }));
      }
    } as unknown as D1Database;

    const repository = new D1AppRepository(database);
    const bundles = await repository.listPublicationBundlesForClient("client_1", 100);

    expect(listQueryCount).toBe(1);
    expect(batchCount).toBe(1);
    expect(bundles.map((bundle) => bundle.publication.id)).toEqual(["pub_2", "pub_1"]);
  });
});

function publicationRow(id: string): Record<string, unknown> {
  return {
    id,
    x_account_id: "acc_1",
    created_by_client_id: "client_1",
    status: "SCHEDULED",
    kind: "STANDARD",
    revision: 1,
    content_hash: `hash_${id}`,
    request_json: "{}",
    overflow_policy: "REJECT",
    approval_preference: "POLICY",
    policy_id: null,
    policy_version: null,
    policy_decision: "ALLOW",
    policy_reasons_json: "[]",
    approval_required: 0,
    active_approval_id: null,
    active_plan_id: null,
    scheduled_at_ms: 1,
    next_action_at_ms: 1,
    lease_token: null,
    lease_until_ms: null,
    root_published_at_ms: null,
    completed_at_ms: null,
    failure_code: null,
    failure_json: null,
    created_at_ms: 1,
    updated_at_ms: 1
  };
}
