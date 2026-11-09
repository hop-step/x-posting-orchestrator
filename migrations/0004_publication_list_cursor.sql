-- Keep account-scoped pages ordered by both parts of the cursor.
CREATE INDEX IF NOT EXISTS idx_publications_account_created_id
ON publications(x_account_id, created_at_ms DESC, id DESC);

DROP INDEX IF EXISTS idx_publications_account_created;

PRAGMA optimize;
