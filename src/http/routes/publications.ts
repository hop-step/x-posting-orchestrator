import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { PublicationService } from "../../application/publication-service";
import type { PublicationRepository } from "../../application/repository";
import type { PublicationListFilter } from "../../application/repository";
import { assertScope } from "../../domain/auth/api-keys";
import { loadConfig } from "../../env";
import { D1AppRepository } from "../../infrastructure/d1/repositories/app-repository";
import { sendDiscordApprovalNotification } from "../../infrastructure/discord/approval-notifier";
import type { PublicationStatus, StepStatus } from "../../domain/publications/entities";
import { systemClock } from "../../shared/clock";
import { badRequest } from "../../shared/errors";
import { randomIdGenerator } from "../../shared/ids";
import { errorMetadata } from "../../shared/logger";
import type { AppBindings } from "../context";

type AppContext = Context<AppBindings>;

const approveBodySchema = z.object({
  revision: z.number().int().positive(),
  contentHash: z.string().min(1),
  comment: z.string().max(1000).optional()
});

const rejectBodySchema = z.object({
  revision: z.number().int().positive(),
  contentHash: z.string().min(1),
  reason: z.string().max(1000).optional()
});

const reconcileBodySchema = z.object({
  stepId: z.string().min(1),
  outcome: z.enum(["PUBLISHED", "NOT_PUBLISHED"]),
  xPostId: z.string().min(1).optional(),
  comment: z.string().max(1000).optional()
});

const problemDismissalBodySchema = z.object({
  comment: z.string().max(1000).optional()
});

const publicationStatusGroups = {
  before: ["DRAFT", "PENDING_APPROVAL", "SCHEDULED", "QUEUED", "PUBLISHING", "AWAITING_FOLLOW_UP", "RETRY_SCHEDULED"],
  posted: ["PUBLISHED", "PARTIALLY_PUBLISHED"],
  attention: ["FAILED", "DELIVERY_UNKNOWN", "BLOCKED_POLICY", "REJECTED", "CANCELLED"]
} satisfies Record<string, PublicationStatus[]>;

const stepStatusGroups = {
  before: ["PENDING", "READY", "UPLOADING_MEDIA", "PUBLISHING", "RETRY_SCHEDULED"],
  posted: ["PUBLISHED"],
  attention: ["FAILED", "DELIVERY_UNKNOWN"]
} satisfies Record<string, StepStatus[]>;

const statusGroupNames = ["before", "posted", "attention"] as const;
type StatusGroupName = (typeof statusGroupNames)[number];

export function publicationRoutes(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.post("/v1/publications/preview", async (c) => {
    const auth = requireRouteAuth(c);
    const service = serviceFor(c);
    const body = await readJson(c.req.raw);
    return json(await service.preview(body, auth.client), 200);
  });

  app.post("/v1/publications", async (c) => {
    const auth = requireRouteAuth(c);
    const repository = repositoryFor(c);
    const service = serviceFor(c, repository);
    const body = await readJson(c.req.raw);
    const result = await service.create(body, auth.client, c.req.header("Idempotency-Key") ?? null, requestMeta(c));
    scheduleDiscordApprovalNotification(c, repository, result.body);
    return json(result.body, result.status);
  });

  app.get("/v1/publications", async (c) => {
    const startedAtMs = Date.now();
    const auth = requireRouteAuth(c);
    const service = serviceFor(c);
    const limit = Number(c.req.query("limit") ?? "50");
    const filter = publicationListFilterFromQuery(c.req.query("statusGroups"));
    const publications = await service.list(auth.client, Number.isFinite(limit) ? limit : 50, filter);
    const includeProblemDismissals = c.req.query("includeProblemDismissals") === "true";
    const problemDismissedPublicationIds = includeProblemDismissals
      ? await listDismissedProblemPublicationIds(
          c,
          publications.map((bundle) => bundle.publication.id)
        )
      : [];
    const elapsedMs = Date.now() - startedAtMs;
    c.header("Server-Timing", `publication-list;dur=${elapsedMs}`);
    c.get("logger")?.log("info", "PUBLICATION_LIST_COMPLETED", {
      clientId: auth.client.id,
      count: publications.length,
      includeProblemDismissals,
      dismissedCount: problemDismissedPublicationIds.length,
      elapsedMs
    });
    return c.json({
      publications: publications.map((bundle) => ({
        publication: bundle.publication,
        plans: bundle.plans,
        approvals: bundle.approvals
      })),
      ...(includeProblemDismissals ? { problemDismissedPublicationIds } : {})
    });
  });

  app.get("/v1/publications/problem-dismissals", async (c) => {
    const auth = requireRouteAuth(c);
    const service = serviceFor(c);
    const limit = Number(c.req.query("limit") ?? "100");
    const filter = publicationListFilterFromQuery(c.req.query("statusGroups"));
    const publications = await service.list(auth.client, Number.isFinite(limit) ? limit : 100, filter);
    const publicationIds = publications.map((bundle) => bundle.publication.id);
    return c.json({
      publicationIds: await listDismissedProblemPublicationIds(c, publicationIds)
    });
  });

  app.get("/v1/publications/:id", async (c) => {
    const auth = requireRouteAuth(c);
    const service = serviceFor(c);
    const bundle = await service.get(c.req.param("id"), auth.client);
    return c.json(bundle);
  });

  app.post("/v1/publications/:id/problem-dismissal", async (c) => {
    const auth = requireRouteAuth(c);
    assertScope(auth.client.scopes, "publication:reconcile", auth.client.actorType);
    const parsed = problemDismissalBodySchema.safeParse(await readJson(c.req.raw));
    if (!parsed.success) {
      throw badRequest("INVALID_PROBLEM_DISMISSAL_REQUEST", "Problem dismissal request is invalid.", { issues: parsed.error.issues });
    }
    const repository = repositoryFor(c);
    const service = serviceFor(c, repository);
    const bundle = await service.get(c.req.param("id"), auth.client);
    const activePlan =
      bundle.plans.find((plan) => plan.id === bundle.publication.activePlanId) || bundle.plans.find((plan) => plan.isActive) || bundle.plans[0];
    const problemStepIds =
      activePlan?.steps
        .filter((step) => step.status === "FAILED" || step.status === "DELIVERY_UNKNOWN")
        .map((step) => step.id) ?? [];
    await repository.recordAuditLog({
      eventType: "PUBLICATION_PROBLEM_DISMISSED",
      actorClientId: auth.client.id,
      xAccountId: bundle.publication.xAccountId,
      publicationId: bundle.publication.id,
      requestId: c.get("requestId"),
      contentHash: bundle.publication.contentHash,
      metadata: {
        status: bundle.publication.status,
        problemStepIds,
        comment: parsed.data.comment ?? null
      },
      createdAtMs: systemClock.nowMs()
    });
    return c.json({
      publicationId: bundle.publication.id,
      dismissed: true
    });
  });

  app.patch("/v1/publications/:id", async (c) => {
    const auth = requireRouteAuth(c);
    const repository = repositoryFor(c);
    const service = serviceFor(c, repository);
    const body = await readJson(c.req.raw);
    const result = await service.patch(c.req.param("id"), body, auth.client, c.req.header("Idempotency-Key") ?? null, requestMeta(c));
    scheduleDiscordApprovalNotification(c, repository, result.body);
    return json(result.body, result.status);
  });

  app.post("/v1/publications/:id/submit", async (c) => {
    const auth = requireRouteAuth(c);
    const repository = repositoryFor(c);
    const service = serviceFor(c, repository);
    const result = await service.submit(c.req.param("id"), auth.client, c.req.header("Idempotency-Key") ?? null, requestMeta(c));
    scheduleDiscordApprovalNotification(c, repository, result.body);
    return json(result.body, result.status);
  });

  app.post("/v1/publications/:id/approve", async (c) => {
    const auth = requireRouteAuth(c);
    const service = serviceFor(c);
    const parsed = approveBodySchema.safeParse(await readJson(c.req.raw));
    if (!parsed.success) {
      throw badRequest("INVALID_APPROVAL_REQUEST", "Approval request is invalid.", { issues: parsed.error.issues });
    }
    const result = await service.approve(c.req.param("id"), parsed.data, auth.client, c.req.header("Idempotency-Key") ?? null, requestMeta(c));
    return json(result.body, result.status);
  });

  app.post("/v1/publications/:id/reject", async (c) => {
    const auth = requireRouteAuth(c);
    const service = serviceFor(c);
    const parsed = rejectBodySchema.safeParse(await readJson(c.req.raw));
    if (!parsed.success) {
      throw badRequest("INVALID_REJECTION_REQUEST", "Rejection request is invalid.", { issues: parsed.error.issues });
    }
    const result = await service.reject(c.req.param("id"), parsed.data, auth.client, c.req.header("Idempotency-Key") ?? null, requestMeta(c));
    return json(result.body, result.status);
  });

  app.post("/v1/publications/:id/cancel", async (c) => {
    const auth = requireRouteAuth(c);
    const service = serviceFor(c);
    const result = await service.cancel(c.req.param("id"), auth.client, c.req.header("Idempotency-Key") ?? null, requestMeta(c));
    return json(result.body, result.status);
  });

  app.post("/v1/publications/:id/retry", async (c) => {
    const auth = requireRouteAuth(c);
    const service = serviceFor(c);
    const result = await service.retry(c.req.param("id"), auth.client, c.req.header("Idempotency-Key") ?? null, requestMeta(c));
    return json(result.body, result.status);
  });

  app.post("/v1/publications/:id/reconcile", async (c) => {
    const auth = requireRouteAuth(c);
    const service = serviceFor(c);
    const parsed = reconcileBodySchema.safeParse(await readJson(c.req.raw));
    if (!parsed.success) {
      throw badRequest("INVALID_RECONCILE_REQUEST", "Reconcile request is invalid.", { issues: parsed.error.issues });
    }
    const result = await service.reconcile(c.req.param("id"), parsed.data, auth.client, c.req.header("Idempotency-Key") ?? null, requestMeta(c));
    return json(result.body, result.status);
  });

  return app;
}

function publicationListFilterFromQuery(value: string | undefined): PublicationListFilter {
  if (value === undefined || value.trim() === "") {
    return {};
  }
  const groups = value
    .split(",")
    .map((group) => group.trim())
    .filter(Boolean);
  if (groups.length === 0 || groups.includes("all")) {
    return {};
  }

  const publicationStatuses = new Set<PublicationStatus>();
  const stepStatuses = new Set<StepStatus>();
  for (const group of groups) {
    if (!isStatusGroupName(group)) {
      throw badRequest("INVALID_PUBLICATION_STATUS_GROUP", "Publication statusGroups query is invalid.", {
        allowed: ["before", "attention", "posted", "all"],
        received: group
      });
    }
    const publicationGroup = publicationStatusGroups[group];
    const stepGroup = stepStatusGroups[group];
    publicationGroup.forEach((status) => publicationStatuses.add(status));
    stepGroup.forEach((status) => stepStatuses.add(status));
  }

  return {
    publicationStatuses: Array.from(publicationStatuses),
    stepStatuses: Array.from(stepStatuses)
  };
}

function isStatusGroupName(value: string): value is StatusGroupName {
  return (statusGroupNames as readonly string[]).includes(value);
}

async function listDismissedProblemPublicationIds(c: AppContext, publicationIds: string[]): Promise<string[]> {
  const uniqueIds = Array.from(new Set(publicationIds.filter(Boolean)));
  if (uniqueIds.length === 0) {
    return [];
  }
  const dismissed = new Set<string>();
  const chunkSize = 90;
  for (let index = 0; index < uniqueIds.length; index += chunkSize) {
    const chunk = uniqueIds.slice(index, index + chunkSize);
    const rows = await c.env.DB.prepare(
      `SELECT DISTINCT publication_id
         FROM audit_logs
        WHERE event_type = 'PUBLICATION_PROBLEM_DISMISSED'
          AND publication_id IN (${chunk.map(() => "?").join(", ")})`
    )
      .bind(...chunk)
      .all<{ publication_id: string | null }>();
    for (const row of rows.results ?? []) {
      if (typeof row.publication_id === "string") {
        dismissed.add(row.publication_id);
      }
    }
  }
  return uniqueIds.filter((id) => dismissed.has(id));
}

function repositoryFor(c: AppContext): D1AppRepository {
  return new D1AppRepository(c.env.DB);
}

function serviceFor(c: AppContext, repository: PublicationRepository = repositoryFor(c)): PublicationService {
  return new PublicationService({
    repository,
    clock: systemClock,
    ids: randomIdGenerator,
    config: loadConfig(c.env)
  });
}

function scheduleDiscordApprovalNotification(c: AppContext, repository: PublicationRepository, body: unknown): void {
  const hasWebhook = c.env.DISCORD_APPROVAL_WEBHOOK_URL?.trim() !== undefined && c.env.DISCORD_APPROVAL_WEBHOOK_URL.trim() !== "";
  const hasBotChannel =
    c.env.DISCORD_BOT_TOKEN?.trim() !== undefined &&
    c.env.DISCORD_BOT_TOKEN.trim() !== "" &&
    c.env.DISCORD_APPROVAL_CHANNEL_ID?.trim() !== undefined &&
    c.env.DISCORD_APPROVAL_CHANNEL_ID.trim() !== "";
  if (!hasWebhook && !hasBotChannel) {
    return;
  }
  const publication = (body as { publication?: { id?: unknown; status?: unknown } })?.publication;
  if (publication?.status !== "PENDING_APPROVAL" || typeof publication.id !== "string") {
    return;
  }
  const notification = sendDiscordApprovalNotification({
    env: c.env,
    repository,
    publicationId: publication.id,
    logger: c.get("logger")
  }).catch((error: unknown) => {
    c.get("logger")?.log("error", "DISCORD_APPROVAL_NOTIFICATION_UNHANDLED", {
      publicationId: publication.id,
      error: errorMetadata(error)
    });
  });
  try {
    c.executionCtx.waitUntil(notification);
  } catch {
    void notification;
  }
}

function requestMeta(c: AppContext): { method: string; path: string; requestId: string } {
  return {
    method: c.req.method,
    path: c.req.path,
    requestId: c.get("requestId")
  };
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw badRequest("INVALID_JSON", "Request body must be valid JSON.");
  }
}

function requireRouteAuth(c: AppContext) {
  const auth = c.get("auth");
  if (auth === null) {
    throw new Error("auth middleware missing");
  }
  return auth;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}
