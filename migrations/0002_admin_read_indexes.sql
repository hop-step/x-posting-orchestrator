CREATE INDEX IF NOT EXISTS idx_publications_status_created
ON publications(status, created_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_approvals_publication_created
ON approvals(publication_id, created_at_ms);

CREATE INDEX IF NOT EXISTS idx_audit_logs_event_publication_created
ON audit_logs(event_type, publication_id, created_at_ms DESC);
