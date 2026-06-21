import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("initial migration", () => {
  const sql = readFileSync("migrations/0001_initial.sql", "utf8");

  it("creates the safety-critical tables", () => {
    for (const table of [
      "x_accounts",
      "api_clients",
      "client_account_permissions",
      "publications",
      "publication_plans",
      "publication_steps",
      "media_assets",
      "approvals",
      "idempotency_records",
      "delivery_attempts",
      "oauth_states",
      "audit_logs"
    ]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });

  it("contains due-publication indexes", () => {
    expect(sql).toContain("idx_publications_due");
    expect(sql).toContain("idx_publications_account_created");
    expect(sql).toContain("idx_publications_creator_created");
  });
});
