import { Hono } from "hono";
import { authorizeAccount } from "../../domain/auth/authorization";
import { validateImageBytes } from "../../domain/media/media-validator";
import { loadConfig } from "../../env";
import { D1AppRepository } from "../../infrastructure/d1/repositories/app-repository";
import { badRequest, forbidden, notFound } from "../../shared/errors";
import { randomHex } from "../../shared/ids";
import type { AppBindings } from "../context";

export function mediaRoutes(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.post("/v1/media", async (c) => {
    const auth = c.get("auth");
    if (auth === null) {
      throw new Error("auth middleware missing");
    }
    const form = await c.req.raw.formData();
    const xAccountId = form.get("xAccountId");
    const file = form.get("file");
    if (typeof xAccountId !== "string" || !(file instanceof File)) {
      throw badRequest("INVALID_MEDIA_REQUEST", "xAccountId and file are required.");
    }
    const repository = new D1AppRepository(c.env.DB);
    await authorizeAccount(repository, auth.client, xAccountId, "media:create");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const validated = await validateImageBytes(bytes, loadConfig(c.env));
    const nowMs = Date.now();
    const mediaId = `media_${randomHex(8)}`;
    const r2Key = `${xAccountId}/${mediaId}`;
    const altTextValue = form.get("altText");
    await c.env.MEDIA_BUCKET.put(r2Key, bytes, {
      httpMetadata: {
        contentType: validated.mimeType
      },
      customMetadata: {
        sha256: validated.sha256
      }
    });
    const asset = {
      id: mediaId,
      xAccountId,
      createdByClientId: auth.client.id,
      r2Key,
      originalFilename: file.name || null,
      mimeType: validated.mimeType,
      sizeBytes: validated.sizeBytes,
      sha256: validated.sha256,
      altText: typeof altTextValue === "string" ? altTextValue.slice(0, 1000) : null,
      aiGenerated: form.get("aiGenerated") === "true",
      status: "READY" as const,
      expiresAtMs: null,
      createdAtMs: nowMs,
      updatedAtMs: nowMs
    };
    await repository.createMediaAsset(asset);
    await repository.recordAuditLog({
      eventType: "MEDIA_UPLOADED",
      actorClientId: auth.client.id,
      xAccountId,
      publicationId: null,
      requestId: c.get("requestId"),
      contentHash: null,
      metadata: { mediaId, sha256: validated.sha256, mimeType: validated.mimeType, sizeBytes: validated.sizeBytes },
      createdAtMs: nowMs
    });
    return c.json({ media: asset }, 201);
  });

  app.get("/v1/media/:id", async (c) => {
    const auth = c.get("auth");
    if (auth === null) {
      throw new Error("auth middleware missing");
    }
    const repository = new D1AppRepository(c.env.DB);
    const asset = await repository.getMediaAsset(c.req.param("id"));
    if (asset === null) {
      throw notFound();
    }
    const permission = await repository.getClientAccountPermission(auth.client.id, asset.xAccountId);
    if (asset.createdByClientId !== auth.client.id && permission === null) {
      throw forbidden("MEDIA_DENIED", "Media asset is not visible to this client.");
    }
    return c.json({ media: asset });
  });

  return app;
}
