import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { PublicationService } from "../../application/publication-service";
import { loadConfig } from "../../env";
import { D1AppRepository } from "../../infrastructure/d1/repositories/app-repository";
import { systemClock } from "../../shared/clock";
import { badRequest } from "../../shared/errors";
import { randomIdGenerator } from "../../shared/ids";
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
    const service = serviceFor(c);
    const body = await readJson(c.req.raw);
    const result = await service.create(body, auth.client, c.req.header("Idempotency-Key") ?? null, requestMeta(c));
    return json(result.body, result.status);
  });

  app.get("/v1/publications", async (c) => {
    const auth = requireRouteAuth(c);
    const service = serviceFor(c);
    const limit = Number(c.req.query("limit") ?? "50");
    const publications = await service.list(auth.client, Number.isFinite(limit) ? limit : 50);
    return c.json({
      publications: publications.map((bundle) => ({
        publication: bundle.publication,
        plans: bundle.plans,
        approvals: bundle.approvals
      }))
    });
  });

  app.get("/v1/publications/:id", async (c) => {
    const auth = requireRouteAuth(c);
    const service = serviceFor(c);
    const bundle = await service.get(c.req.param("id"), auth.client);
    return c.json(bundle);
  });

  app.patch("/v1/publications/:id", async (c) => {
    const auth = requireRouteAuth(c);
    const service = serviceFor(c);
    const body = await readJson(c.req.raw);
    const result = await service.patch(c.req.param("id"), body, auth.client, c.req.header("Idempotency-Key") ?? null, requestMeta(c));
    return json(result.body, result.status);
  });

  app.post("/v1/publications/:id/submit", async (c) => {
    const auth = requireRouteAuth(c);
    const service = serviceFor(c);
    const result = await service.submit(c.req.param("id"), auth.client, c.req.header("Idempotency-Key") ?? null, requestMeta(c));
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

function serviceFor(c: AppContext): PublicationService {
  return new PublicationService({
    repository: new D1AppRepository(c.env.DB),
    clock: systemClock,
    ids: randomIdGenerator,
    config: loadConfig(c.env)
  });
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
