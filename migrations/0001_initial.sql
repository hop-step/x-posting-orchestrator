CREATE TABLE IF NOT EXISTS x_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  x_user_id TEXT UNIQUE,
  x_username TEXT,
  status TEXT NOT NULL,
  longform_capability TEXT NOT NULL DEFAULT 'UNKNOWN',
  self_reply_capability TEXT NOT NULL DEFAULT 'UNVERIFIED',
  access_token_ciphertext TEXT,
  access_token_iv TEXT,
  refresh_token_ciphertext TEXT,
  refresh_token_iv TEXT,
  token_key_version INTEGER,
  access_token_expires_at_ms INTEGER,
  scopes_json TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS api_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  key_prefix TEXT UNIQUE NOT NULL,
  key_digest TEXT NOT NULL,
  status TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  expires_at_ms INTEGER,
  last_used_at_ms INTEGER,
  daily_request_limit INTEGER,
  daily_publish_limit INTEGER,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS client_account_permissions (
  client_id TEXT NOT NULL,
  x_account_id TEXT NOT NULL,
  permission_level INTEGER NOT NULL,
  policy_id TEXT,
  max_thread_parts INTEGER NOT NULL DEFAULT 10,
  allowed_hours_json TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (client_id, x_account_id)
);

CREATE TABLE IF NOT EXISTS publication_policies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  rules_json TEXT NOT NULL,
  is_active INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  UNIQUE (id, version)
);

CREATE TABLE IF NOT EXISTS publications (
  id TEXT PRIMARY KEY,
  x_account_id TEXT NOT NULL,
  created_by_client_id TEXT NOT NULL,
  status TEXT NOT NULL,
  kind TEXT NOT NULL,
  revision INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  request_json TEXT NOT NULL,
  overflow_policy TEXT NOT NULL,
  approval_preference TEXT NOT NULL,
  policy_id TEXT,
  policy_version INTEGER,
  policy_decision TEXT NOT NULL,
  policy_reasons_json TEXT NOT NULL,
  approval_required INTEGER NOT NULL,
  active_approval_id TEXT,
  active_plan_id TEXT,
  scheduled_at_ms INTEGER NOT NULL,
  next_action_at_ms INTEGER,
  lease_token TEXT,
  lease_until_ms INTEGER,
  root_published_at_ms INTEGER,
  completed_at_ms INTEGER,
  failure_code TEXT,
  failure_json TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_publications_due
ON publications(status, next_action_at_ms);

CREATE INDEX IF NOT EXISTS idx_publications_account_created
ON publications(x_account_id, created_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_publications_creator_created
ON publications(created_by_client_id, created_at_ms DESC);

CREATE TABLE IF NOT EXISTS publication_plans (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  strategy TEXT NOT NULL,
  plan_hash TEXT NOT NULL,
  capability_requirements_json TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at_ms INTEGER NOT NULL,
  UNIQUE (publication_id, kind)
);

CREATE TABLE IF NOT EXISTS publication_steps (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  sequence_no INTEGER NOT NULL,
  step_type TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  reply_to_step_id TEXT,
  trigger_type TEXT NOT NULL,
  trigger_offset_minutes INTEGER NOT NULL DEFAULT 0,
  resolved_due_at_ms INTEGER,
  text TEXT NOT NULL,
  poll_json TEXT,
  weighted_length INTEGER NOT NULL,
  made_with_ai INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  x_post_id TEXT UNIQUE,
  published_at_ms INTEGER,
  next_attempt_at_ms INTEGER,
  last_error_code TEXT,
  last_error_json TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  UNIQUE (plan_id, sequence_no)
);

CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  x_account_id TEXT NOT NULL,
  created_by_client_id TEXT NOT NULL,
  r2_key TEXT UNIQUE NOT NULL,
  original_filename TEXT,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  alt_text TEXT,
  ai_generated INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  expires_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS publication_step_media (
  step_id TEXT NOT NULL,
  media_asset_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (step_id, media_asset_id),
  UNIQUE (step_id, position)
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  decision TEXT NOT NULL,
  actor_client_id TEXT NOT NULL,
  comment TEXT,
  revoked_at_ms INTEGER,
  revoked_reason TEXT,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  client_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  response_status INTEGER,
  response_body_json TEXT,
  expires_at_ms INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (client_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS delivery_attempts (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  attempt_no INTEGER NOT NULL,
  request_fingerprint TEXT NOT NULL,
  outcome TEXT NOT NULL,
  http_status INTEGER,
  x_request_id TEXT,
  retry_at_ms INTEGER,
  error_code TEXT,
  error_json TEXT,
  started_at_ms INTEGER NOT NULL,
  completed_at_ms INTEGER,
  UNIQUE (step_id, attempt_no)
);

CREATE TABLE IF NOT EXISTS oauth_states (
  id TEXT PRIMARY KEY,
  state_digest TEXT UNIQUE NOT NULL,
  x_account_id TEXT NOT NULL,
  code_verifier_ciphertext TEXT NOT NULL,
  code_verifier_iv TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  consumed_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  actor_client_id TEXT,
  x_account_id TEXT,
  publication_id TEXT,
  request_id TEXT,
  content_hash TEXT,
  metadata_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);
