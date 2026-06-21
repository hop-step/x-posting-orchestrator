import { z } from "zod";
import type { AppConfig } from "../../env";
import { badRequest, unprocessable } from "../../shared/errors";
import type { PublicationRequest } from "./entities";

const offsetDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

export const publicationKindSchema = z.enum(["TEXT", "IMAGE", "POLL"]);
export const overflowPolicySchema = z.enum(["REJECT", "THREAD", "LONGFORM_THEN_THREAD"]).default("REJECT");
export const approvalPreferenceSchema = z.enum(["POLICY", "REQUIRE_APPROVAL"]).default("POLICY");

export const publicationRequestInputSchema = z.object({
  xAccountId: z.string().min(1),
  scheduledAt: z.string().min(1),
  kind: publicationKindSchema,
  content: z.object({
    text: z.string().min(1),
    mediaIds: z.array(z.string().min(1)).optional().default([]),
    poll: z
      .object({
        options: z.array(z.string().min(1)).min(2).max(4),
        durationMinutes: z.number().int().positive()
      })
      .nullable()
      .optional()
      .default(null),
    madeWithAi: z.boolean().optional().default(false)
  }),
  overflowPolicy: overflowPolicySchema,
  threadOptions: z
    .object({
      numbering: z.boolean().optional().default(true),
      maxParts: z.number().int().positive().optional(),
      mediaPlacement: z.literal("FIRST").optional().default("FIRST")
    })
    .optional()
    .default({}),
  followUps: z
    .array(
      z.object({
        trigger: z.object({
          type: z.enum(["AFTER_PARENT_PUBLISHED", "AFTER_POLL_CLOSE"]),
          offsetMinutes: z.number().int().min(0)
        }),
        content: z.object({
          text: z.string().min(1)
        })
      })
    )
    .optional()
    .default([]),
  approvalPreference: approvalPreferenceSchema
});

export type PublicationRequestInput = z.input<typeof publicationRequestInputSchema>;

export function parsePublicationRequest(input: unknown, nowMs: number, config: AppConfig): PublicationRequest {
  const parsed = publicationRequestInputSchema.safeParse(input);
  if (!parsed.success) {
    throw badRequest("INVALID_PUBLICATION_REQUEST", "Publication request is invalid.", { issues: parsed.error.issues });
  }

  const scheduledAt = parsed.data.scheduledAt;
  if (!offsetDateTimePattern.test(scheduledAt)) {
    throw unprocessable("DATETIME_OFFSET_REQUIRED", "scheduledAt must be ISO 8601 with timezone offset.");
  }
  const scheduledAtMs = Date.parse(scheduledAt);
  if (!Number.isFinite(scheduledAtMs)) {
    throw unprocessable("INVALID_DATETIME", "scheduledAt is not a valid datetime.");
  }
  if (scheduledAtMs <= nowMs) {
    throw unprocessable("SCHEDULED_AT_IN_PAST", "scheduledAt must be in the future.");
  }

  const maxParts = parsed.data.threadOptions.maxParts ?? config.defaultMaxThreadParts;
  if (maxParts > config.absoluteMaxThreadParts) {
    throw unprocessable("MAX_THREAD_PARTS_EXCEEDED", "threadOptions.maxParts exceeds the absolute maximum.", {
      maxParts,
      absoluteMaxThreadParts: config.absoluteMaxThreadParts
    });
  }
  if (parsed.data.followUps.length > config.maxFollowUps) {
    throw unprocessable("TOO_MANY_FOLLOW_UPS", "Too many follow-up replies.", {
      maxFollowUps: config.maxFollowUps
    });
  }

  return {
    ...parsed.data,
    scheduledAtMs,
    content: {
      ...parsed.data.content,
      text: normalizeText(parsed.data.content.text),
      mediaIds: parsed.data.content.mediaIds,
      poll: parsed.data.content.poll,
      madeWithAi: parsed.data.content.madeWithAi
    },
    threadOptions: {
      numbering: parsed.data.threadOptions.numbering,
      maxParts,
      mediaPlacement: parsed.data.threadOptions.mediaPlacement
    },
    followUps: parsed.data.followUps.map((followUp) => ({
      ...followUp,
      content: {
        text: normalizeText(followUp.content.text)
      }
    }))
  };
}

export function normalizeText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}
