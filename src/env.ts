import type { PublishQueueMessage } from "./workers/messages";

export interface Env {
  DB: D1Database;
  MEDIA_BUCKET?: R2Bucket;
  PUBLISH_QUEUE: Queue<PublishQueueMessage>;
  X_CLIENT_ID?: string;
  X_CLIENT_SECRET?: string;
  TOKEN_ENCRYPTION_KEY_V1?: string;
  ADMIN_BASIC_USERNAME?: string;
  ADMIN_BASIC_PASSWORD?: string;
  API_KEY_PEPPER: string;
  PUBLIC_BASE_URL: string;
  ALLOWED_CORS_ORIGINS?: string;
  SCHEDULE_GRACE_SECONDS?: string;
  LEASE_DURATION_SECONDS?: string;
  DEFAULT_MAX_THREAD_PARTS?: string;
  ABSOLUTE_MAX_THREAD_PARTS?: string;
  MAX_FOLLOW_UPS?: string;
  MAX_IMAGE_BYTES?: string;
  MAX_IMAGE_COUNT?: string;
  IDEMPOTENCY_TTL_HOURS?: string;
  OAUTH_STATE_TTL_MINUTES?: string;
  TOKEN_REFRESH_MARGIN_MINUTES?: string;
  MAX_DELIVERY_ATTEMPTS?: string;
  DUPLICATE_CONTENT_WINDOW_HOURS?: string;
  LIVE_X_TEST?: string;
  X_TEST_ACCOUNT_ID?: string;
}

export interface AppConfig {
  scheduleGraceSeconds: number;
  leaseDurationSeconds: number;
  defaultMaxThreadParts: number;
  absoluteMaxThreadParts: number;
  maxFollowUps: number;
  maxImageBytes: number;
  maxImageCount: number;
  idempotencyTtlHours: number;
  oauthStateTtlMinutes: number;
  tokenRefreshMarginMinutes: number;
  maxDeliveryAttempts: number;
  duplicateContentWindowHours: number;
}

export function loadConfig(env: Env): AppConfig {
  return {
    scheduleGraceSeconds: numberFromEnv(env.SCHEDULE_GRACE_SECONDS, 120),
    leaseDurationSeconds: numberFromEnv(env.LEASE_DURATION_SECONDS, 120),
    defaultMaxThreadParts: numberFromEnv(env.DEFAULT_MAX_THREAD_PARTS, 10),
    absoluteMaxThreadParts: numberFromEnv(env.ABSOLUTE_MAX_THREAD_PARTS, 25),
    maxFollowUps: numberFromEnv(env.MAX_FOLLOW_UPS, 3),
    maxImageBytes: numberFromEnv(env.MAX_IMAGE_BYTES, 5_242_880),
    maxImageCount: numberFromEnv(env.MAX_IMAGE_COUNT, 4),
    idempotencyTtlHours: numberFromEnv(env.IDEMPOTENCY_TTL_HOURS, 24),
    oauthStateTtlMinutes: numberFromEnv(env.OAUTH_STATE_TTL_MINUTES, 10),
    tokenRefreshMarginMinutes: numberFromEnv(env.TOKEN_REFRESH_MARGIN_MINUTES, 10),
    maxDeliveryAttempts: numberFromEnv(env.MAX_DELIVERY_ATTEMPTS, 5),
    duplicateContentWindowHours: numberFromEnv(env.DUPLICATE_CONTENT_WINDOW_HOURS, 24)
  };
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
