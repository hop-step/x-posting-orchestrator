import { z } from "zod";
import type { PublicationListCursor } from "../application/repository";
import { badRequest } from "../shared/errors";

const cursorSchema = z.tuple([z.literal(1), z.number().int().safe().nonnegative(), z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/u)]);
const invalidCursor = () => badRequest("INVALID_PUBLICATION_CURSOR", "Use nextCursor from a previous publication list response.");

export function encodePublicationListCursor(cursor: PublicationListCursor): string {
  return btoa(JSON.stringify([1, cursor.createdAtMs, cursor.id])).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

export function decodePublicationListCursor(cursor: string): PublicationListCursor {
  if (cursor.length > 256 || !/^[a-zA-Z0-9_-]+$/u.test(cursor)) {
    throw invalidCursor();
  }
  let value: unknown;
  try {
    value = JSON.parse(atob(cursor.replace(/-/gu, "+").replace(/_/gu, "/")));
  } catch {
    throw invalidCursor();
  }
  const parsed = cursorSchema.safeParse(value);
  if (!parsed.success) {
    throw invalidCursor();
  }
  const [, createdAtMs, id] = parsed.data;
  return { createdAtMs, id };
}
