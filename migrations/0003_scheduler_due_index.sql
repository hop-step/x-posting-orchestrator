-- Keep the minute-by-minute scheduler lookup within the pending-publication index.
CREATE INDEX IF NOT EXISTS idx_publications_pending_due
ON publications(next_action_at_ms, lease_until_ms, id, revision, content_hash, status)
WHERE status IN ('SCHEDULED', 'QUEUED', 'AWAITING_FOLLOW_UP', 'RETRY_SCHEDULED');

DROP INDEX IF EXISTS idx_publications_due;

PRAGMA optimize;
