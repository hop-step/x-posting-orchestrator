import type { Env } from "../../env";
import { activePlan, type PublicationRepository } from "../../application/repository";
import type { PublicationBundle } from "../../domain/publications/entities";
import { errorMetadata, type Logger } from "../../shared/logger";

const textEncoder = new TextEncoder();
const DISCORD_API_BASE = "https://discord.com/api/v10";

export type DiscordPublicationFailureStatus = "FAILED" | "DELIVERY_UNKNOWN" | "BLOCKED_POLICY";

export interface DiscordApprovalNotificationResult {
  status: "SENT" | "SKIPPED" | "FAILED";
  reason?: string;
  httpStatus?: number;
}

export interface DiscordWebhookPayload {
  content: string;
  embeds: DiscordEmbed[];
  components: DiscordActionRow[];
  allowed_mentions: {
    parse: [];
  };
}

interface DiscordEmbed {
  title: string;
  description?: string;
  color: number;
  fields: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
}

interface DiscordActionRow {
  type: 1;
  components: DiscordLinkButton[];
}

interface DiscordLinkButton {
  type: 2;
  style: 5;
  label: string;
  url: string;
}

export async function sendDiscordApprovalNotification(params: {
  env: Env;
  repository: PublicationRepository;
  publicationId: string;
  fetcher?: typeof fetch;
  logger?: Logger;
  nowMs?: number;
}): Promise<DiscordApprovalNotificationResult> {
  const destination = notificationDestination(params.env);
  const webhookUrl = params.env.DISCORD_APPROVAL_WEBHOOK_URL?.trim();
  if (destination === null && (webhookUrl === undefined || webhookUrl === "")) {
    return { status: "SKIPPED", reason: "DISCORD_APPROVAL_DESTINATION_MISSING" };
  }

  const bundle = await params.repository.getPublicationBundle(params.publicationId);
  if (bundle === null) {
    return { status: "SKIPPED", reason: "PUBLICATION_NOT_FOUND" };
  }
  if (bundle.publication.status !== "PENDING_APPROVAL") {
    return { status: "SKIPPED", reason: "PUBLICATION_NOT_PENDING_APPROVAL" };
  }

  const payload = buildDiscordApprovalPayload(bundle, params.env.PUBLIC_BASE_URL);
  let response: Response;
  try {
    response =
      destination === null
        ? await sendWebhookMessage(params.fetcher ?? fetch, webhookUrl ?? "", payload)
        : await sendBotChannelMessage(params.fetcher ?? fetch, destination, payload);
  } catch (error) {
    params.logger?.log("error", "DISCORD_APPROVAL_NOTIFICATION_FETCH_FAILED", {
      publicationId: bundle.publication.id,
      error: errorMetadata(error)
    });
    await recordNotificationAudit(params.repository, bundle, "FAILED", params.nowMs ?? Date.now(), {
      reason: "FETCH_FAILED",
      error: errorMetadata(error)
    });
    return { status: "FAILED", reason: "FETCH_FAILED" };
  }

  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    params.logger?.log("warn", "DISCORD_APPROVAL_NOTIFICATION_REJECTED", {
      publicationId: bundle.publication.id,
      destination: destination?.type ?? "WEBHOOK",
      httpStatus: response.status,
      responseText: responseText.slice(0, 500)
    });
    await recordNotificationAudit(params.repository, bundle, "FAILED", params.nowMs ?? Date.now(), {
      reason: "DISCORD_REJECTED",
      httpStatus: response.status,
      responseText: responseText.slice(0, 500)
    });
    return { status: "FAILED", reason: "DISCORD_REJECTED", httpStatus: response.status };
  }

  await recordNotificationAudit(params.repository, bundle, "SENT", params.nowMs ?? Date.now(), {
    destination: destination?.type ?? "WEBHOOK",
    httpStatus: response.status
  });
  return { status: "SENT", httpStatus: response.status };
}

export async function sendDiscordPublicationFailureNotification(params: {
  env: Env;
  repository: PublicationRepository;
  publicationId: string;
  status: DiscordPublicationFailureStatus;
  fetcher?: typeof fetch;
  logger?: Logger;
  nowMs?: number;
}): Promise<DiscordApprovalNotificationResult> {
  const destination = failureNotificationDestination(params.env);
  const webhookUrl = failureWebhookUrl(params.env);
  if (destination === null && webhookUrl === null) {
    return { status: "SKIPPED", reason: "DISCORD_FAILURE_DESTINATION_MISSING" };
  }

  const bundle = await params.repository.getPublicationBundle(params.publicationId);
  if (bundle === null) {
    return { status: "SKIPPED", reason: "PUBLICATION_NOT_FOUND" };
  }
  if (!isFailurePublicationStatus(bundle.publication.status)) {
    return { status: "SKIPPED", reason: "PUBLICATION_NOT_FAILED" };
  }

  const payload = buildDiscordPublicationFailurePayload(bundle, params.env.PUBLIC_BASE_URL, params.status);
  let response: Response;
  try {
    response =
      destination === null
        ? await sendWebhookMessage(params.fetcher ?? fetch, webhookUrl ?? "", payload)
        : await sendBotChannelMessage(params.fetcher ?? fetch, destination, payload);
  } catch (error) {
    params.logger?.log("error", "DISCORD_PUBLICATION_FAILURE_NOTIFICATION_FETCH_FAILED", {
      publicationId: bundle.publication.id,
      status: params.status,
      error: errorMetadata(error)
    });
    await recordPublicationFailureNotificationAudit(params.repository, bundle, "FAILED", params.nowMs ?? Date.now(), {
      status: params.status,
      reason: "FETCH_FAILED",
      error: errorMetadata(error)
    });
    return { status: "FAILED", reason: "FETCH_FAILED" };
  }

  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    params.logger?.log("warn", "DISCORD_PUBLICATION_FAILURE_NOTIFICATION_REJECTED", {
      publicationId: bundle.publication.id,
      status: params.status,
      destination: destination?.type ?? "WEBHOOK",
      httpStatus: response.status,
      responseText: responseText.slice(0, 500)
    });
    await recordPublicationFailureNotificationAudit(params.repository, bundle, "FAILED", params.nowMs ?? Date.now(), {
      status: params.status,
      reason: "DISCORD_REJECTED",
      httpStatus: response.status,
      responseText: responseText.slice(0, 500)
    });
    return { status: "FAILED", reason: "DISCORD_REJECTED", httpStatus: response.status };
  }

  await recordPublicationFailureNotificationAudit(params.repository, bundle, "SENT", params.nowMs ?? Date.now(), {
    status: params.status,
    destination: destination?.type ?? "WEBHOOK",
    httpStatus: response.status
  });
  return { status: "SENT", httpStatus: response.status };
}

export function buildDiscordApprovalPayload(bundle: PublicationBundle, publicBaseUrl: string): DiscordWebhookPayload {
  return {
    content: "承認待ちのX投稿があります。管理画面で内容を確認してください。",
    embeds: [approvalEmbed(bundle, "承認待ちのX投稿", 0x087f78)],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 5,
            label: "管理画面",
            url: `${publicBaseUrl.replace(/\/$/u, "")}/admin`
          }
        ]
      }
    ],
    allowed_mentions: { parse: [] }
  };
}

export function buildDiscordPublicationFailurePayload(
  bundle: PublicationBundle,
  publicBaseUrl: string,
  status: DiscordPublicationFailureStatus = bundle.publication.status as DiscordPublicationFailureStatus
): DiscordWebhookPayload {
  const isUnknown = status === "DELIVERY_UNKNOWN";
  return {
    content: isUnknown
      ? "X投稿の送信結果が不明です。自動再送は停止しています。"
      : `X投稿が失敗しました。status: ${status}`,
    embeds: [publicationFailureEmbed(bundle, status)],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 5,
            label: "管理画面",
            url: `${publicBaseUrl.replace(/\/$/u, "")}/admin`
          }
        ]
      }
    ],
    allowed_mentions: { parse: [] }
  };
}

export async function verifyDiscordRequestSignature(params: {
  publicKeyHex: string;
  signatureHex: string;
  timestamp: string;
  body: string;
}): Promise<boolean> {
  const publicKey = hexToBytes(params.publicKeyHex, 32);
  const signature = hexToBytes(params.signatureHex, 64);
  if (publicKey === null || signature === null || params.timestamp === "") {
    return false;
  }

  try {
    const key = await crypto.subtle.importKey("raw", toArrayBuffer(publicKey), "Ed25519", false, ["verify"]);
    const message = textEncoder.encode(params.timestamp + params.body);
    return await crypto.subtle.verify("Ed25519", key, toArrayBuffer(signature), toArrayBuffer(message));
  } catch {
    return false;
  }
}

function approvalEmbed(bundle: PublicationBundle, title: string, color: number): DiscordEmbed {
  const publication = bundle.publication;
  const request = publication.request;
  const plan = activePlan(bundle);
  const stepCount = plan?.steps.length ?? 0;
  const mediaCount = request.content.mediaIds.length;
  const poll = request.content.poll;
  const memo = memoSummary(request.memo);
  const fields: DiscordEmbed["fields"] = [
    { name: "Publication ID", value: publication.id, inline: true },
    { name: "Revision", value: String(publication.revision), inline: true },
    { name: "投稿先", value: publication.xAccountId, inline: true },
    { name: "投稿予定", value: formatDateJst(publication.scheduledAtMs), inline: true },
    { name: "Status", value: publication.status, inline: true },
    { name: "Step", value: `${stepCount || 1}件`, inline: true }
  ];
  if (poll !== null) {
    fields.push({ name: "投票", value: `${poll.options.join(" / ")} (${formatDurationMinutes(poll.durationMinutes)})`, inline: false });
  }
  if (mediaCount > 0) {
    fields.push({ name: "画像", value: `${mediaCount}枚`, inline: true });
  }
  if (memo !== "") {
    fields.push({ name: "memo", value: memo, inline: false });
  }
  if (publication.policyReasons.length > 0) {
    fields.push({ name: "Policy", value: truncateForDiscord(publication.policyReasons.join("\n"), 900), inline: false });
  }

  return {
    title,
    description: truncateForDiscord(request.content.text, 1200),
    color,
    fields
  };
}

function notificationDestination(env: Env): { type: "BOT_CHANNEL"; botToken: string; channelId: string } | null {
  const botToken = env.DISCORD_BOT_TOKEN?.trim();
  const channelId = env.DISCORD_APPROVAL_CHANNEL_ID?.trim();
  if (botToken === undefined || botToken === "" || channelId === undefined || channelId === "") {
    return null;
  }
  return { type: "BOT_CHANNEL", botToken, channelId };
}

function failureNotificationDestination(env: Env): { type: "BOT_CHANNEL"; botToken: string; channelId: string } | null {
  const botToken = env.DISCORD_BOT_TOKEN?.trim();
  const channelId = env.DISCORD_FAILURE_CHANNEL_ID?.trim() || env.DISCORD_APPROVAL_CHANNEL_ID?.trim();
  if (botToken === undefined || botToken === "" || channelId === undefined || channelId === "") {
    return null;
  }
  return { type: "BOT_CHANNEL", botToken, channelId };
}

function failureWebhookUrl(env: Env): string | null {
  const webhookUrl = env.DISCORD_FAILURE_WEBHOOK_URL?.trim() || env.DISCORD_APPROVAL_WEBHOOK_URL?.trim();
  return webhookUrl === undefined || webhookUrl === "" ? null : webhookUrl;
}

async function sendBotChannelMessage(
  fetcher: typeof fetch,
  destination: { botToken: string; channelId: string },
  payload: DiscordWebhookPayload
): Promise<Response> {
  return fetcher(`${DISCORD_API_BASE}/channels/${encodeURIComponent(destination.channelId)}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${destination.botToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

async function sendWebhookMessage(fetcher: typeof fetch, webhookUrl: string, payload: DiscordWebhookPayload): Promise<Response> {
  return fetcher(webhookEndpoint(webhookUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

function webhookEndpoint(webhookUrl: string): string {
  const url = new URL(webhookUrl);
  url.searchParams.set("wait", "true");
  url.searchParams.set("with_components", "true");
  return url.toString();
}

async function recordNotificationAudit(
  repository: PublicationRepository,
  bundle: PublicationBundle,
  result: "SENT" | "FAILED",
  nowMs: number,
  metadata: Record<string, unknown>
): Promise<void> {
  try {
    await repository.recordAuditLog({
      eventType: result === "SENT" ? "DISCORD_APPROVAL_NOTIFICATION_SENT" : "DISCORD_APPROVAL_NOTIFICATION_FAILED",
      actorClientId: null,
      xAccountId: bundle.publication.xAccountId,
      publicationId: bundle.publication.id,
      requestId: null,
      contentHash: bundle.publication.contentHash,
      metadata,
      createdAtMs: nowMs
    });
  } catch {
    // Notification audit failure must not block publication creation.
  }
}

async function recordPublicationFailureNotificationAudit(
  repository: PublicationRepository,
  bundle: PublicationBundle,
  result: "SENT" | "FAILED",
  nowMs: number,
  metadata: Record<string, unknown>
): Promise<void> {
  try {
    await repository.recordAuditLog({
      eventType: result === "SENT" ? "DISCORD_PUBLICATION_FAILURE_NOTIFICATION_SENT" : "DISCORD_PUBLICATION_FAILURE_NOTIFICATION_FAILED",
      actorClientId: null,
      xAccountId: bundle.publication.xAccountId,
      publicationId: bundle.publication.id,
      requestId: null,
      contentHash: bundle.publication.contentHash,
      metadata,
      createdAtMs: nowMs
    });
  } catch {
    // Notification audit failure must not block publication handling.
  }
}

function publicationFailureEmbed(bundle: PublicationBundle, status: DiscordPublicationFailureStatus): DiscordEmbed {
  const publication = bundle.publication;
  const request = publication.request;
  const plan = activePlan(bundle);
  const failedSteps = (plan?.steps ?? []).filter((step) => step.status === "FAILED" || step.status === "DELIVERY_UNKNOWN");
  const publishedPostIds = (plan?.steps ?? [])
    .filter((step) => step.xPostId !== null)
    .map((step) => `Step ${step.sequence}: ${step.xPostId}`)
    .join("\n");
  const failedStepSummary = failedSteps
    .map((step) => `Step ${step.sequence} ${step.stepType}: ${step.status}${step.lastErrorCode === null ? "" : ` (${step.lastErrorCode})`}`)
    .join("\n");
  const failedStepText = failedSteps[0]?.text;
  const fields: DiscordEmbed["fields"] = [
    { name: "Publication ID", value: publication.id, inline: true },
    { name: "投稿先", value: publication.xAccountId, inline: true },
    { name: "投稿予定", value: formatDateJst(publication.scheduledAtMs), inline: true },
    { name: "Status", value: status, inline: true }
  ];
  if (publication.failureCode !== null) {
    fields.push({ name: "Failure Code", value: publication.failureCode, inline: true });
  }
  if (failedStepSummary !== "") {
    fields.push({ name: "失敗Step", value: truncateForDiscord(failedStepSummary, 900), inline: false });
  }
  if (publishedPostIds !== "") {
    fields.push({ name: "X投稿ID", value: truncateForDiscord(publishedPostIds, 900), inline: false });
  }
  const memo = memoSummary(request.memo);
  if (memo !== "") {
    fields.push({ name: "memo", value: memo, inline: false });
  }
  if (failedStepText !== undefined && failedStepText !== request.content.text) {
    fields.push({ name: "失敗Step本文", value: truncateForDiscord(failedStepText, 900), inline: false });
  }
  fields.push({
    name: "対応",
    value:
      status === "DELIVERY_UNKNOWN"
        ? "X上で投稿有無を確認してください。投稿済みの可能性があるため自動再送はしません。"
        : "管理画面で内容とエラーを確認してください。",
    inline: false
  });

  return {
    title: status === "DELIVERY_UNKNOWN" ? "X投稿の送信結果が不明です" : "X投稿が失敗しました",
    description: truncateForDiscord(request.content.text, 1200),
    color: status === "DELIVERY_UNKNOWN" ? 0xf0a202 : 0xb42318,
    fields
  };
}

function isFailurePublicationStatus(status: string): status is DiscordPublicationFailureStatus {
  return status === "FAILED" || status === "DELIVERY_UNKNOWN" || status === "BLOCKED_POLICY";
}

function memoSummary(memo: Record<string, string | number | boolean | null>): string {
  return Object.entries(memo)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .slice(0, 6)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join("\n");
}

function formatDateJst(value: number): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatDurationMinutes(value: number): string {
  if (value % 1440 === 0) {
    return `${value / 1440}日`;
  }
  if (value % 60 === 0) {
    return `${value / 60}時間`;
  }
  return `${value}分`;
}

function truncateForDiscord(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function hexToBytes(hex: string, expectedBytes: number): Uint8Array | null {
  const normalized = hex.trim();
  if (!/^[a-f0-9]+$/iu.test(normalized) || normalized.length !== expectedBytes * 2) {
    return null;
  }
  const bytes = new Uint8Array(expectedBytes);
  for (let index = 0; index < normalized.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
