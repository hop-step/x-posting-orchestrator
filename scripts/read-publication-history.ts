import { pathToFileURL } from "node:url";
import { z } from "zod";
import { comparePublicationListKeys, type PublicationListCursor } from "../src/application/repository";

const timestamp = z.number().int().safe().nonnegative();
const textContent = z.object({ text: z.string() });
const historyBundle = z.object({
  publication: z.object({
    id: z.string().min(1),
    xAccountId: z.string().min(1),
    status: z.string().min(1),
    createdAtMs: timestamp,
    scheduledAtMs: timestamp,
    rootPublishedAtMs: timestamp.nullable(),
    completedAtMs: timestamp.nullable(),
    request: z.object({
      content: textContent,
      followUps: z.array(z.object({ content: textContent })).default([]),
      memo: z.record(z.unknown()).default({})
    })
  }),
  plans: z.array(z.object({
    steps: z.array(z.object({
      text: z.string(),
      publishedAtMs: timestamp.nullable(),
      xPostId: z.string().nullable()
    }))
  }))
});

const historyPage = z.object({
  publications: z.array(historyBundle).max(100),
  nextCursor: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/u).nullable()
});

type HistoryBundle = z.infer<typeof historyBundle>;

interface HistoryOptions {
  baseUrl: string;
  apiKey: string;
  xAccountId: string;
  nowMs?: number;
  fetchPage?: typeof fetch;
}

export async function readPublicationHistory(options: HistoryOptions) {
  const url = new URL(options.baseUrl);
  const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !localHttp) || url.username || url.password || url.search || url.hash) {
    throw new Error("Invalid publication API base URL.");
  }
  url.pathname = url.pathname.replace(/\/$/u, "") + "/v1/publications";
  url.searchParams.set("limit", "100");
  url.searchParams.set("xAccountId", options.xAccountId);
  const nowMs = options.nowMs ?? Date.now();
  const cutoffMs = nowMs - 60 * 24 * 60 * 60 * 1000;
  const request = options.fetchPage ?? fetch;
  const publications: HistoryBundle[] = [];
  const seenIds = new Set<string>();
  const seenCursors = new Set<string>();
  let previous: PublicationListCursor | undefined;
  let cursor: string | null = null;
  let pages = 0;

  do {
    if (++pages > 1_000) {
      throw new Error("Publication history safety limit reached before the last page.");
    }
    if (cursor !== null) {
      url.searchParams.set("cursor", cursor);
    }
    const response = await request(url.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${options.apiKey}`, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(20_000)
    }).catch(() => { throw new Error(`Publication history request failed on page ${pages}.`); });
    if (!response.ok) {
      throw new Error(`Publication history page ${pages} returned HTTP ${response.status}.`);
    }
    const body: unknown = await response.json().catch(() => null);
    const parsed = historyPage.safeParse(body);
    if (!parsed.success) {
      throw new Error(`Publication history page ${pages} is invalid or does not support pagination.`);
    }
    const page = parsed.data;
    if (page.nextCursor !== null && (page.publications.length === 0 || seenCursors.has(page.nextCursor))) {
      throw new Error(`Publication history cursor did not advance on page ${pages}.`);
    }
    for (const bundle of page.publications) {
      const publication = bundle.publication;
      if (publication.xAccountId !== options.xAccountId || seenIds.has(publication.id) ||
        (previous !== undefined && comparePublicationListKeys(publication, previous) >= 0)) {
        throw new Error(`Publication history scope or order is invalid on page ${pages}.`);
      }
      seenIds.add(publication.id);
      previous = publication;
      const eventTimes = [publication.createdAtMs, publication.scheduledAtMs, publication.rootPublishedAtMs, publication.completedAtMs];
      // Keep future reservations and late replies even when the parent was created before the window.
      if (eventTimes.some((time) => time !== null && time >= cutoffMs) ||
        bundle.plans.some((plan) => plan.steps.some((step) => step.publishedAtMs !== null && step.publishedAtMs >= cutoffMs))) {
        publications.push(bundle);
      }
    }
    cursor = page.nextCursor;
    if (cursor !== null) {
      seenCursors.add(cursor);
    }
  } while (cursor !== null);

  return { complete: true as const, xAccountId: options.xAccountId, cutoffMs, pages, scannedCount: seenIds.size, publications };
}

async function main(): Promise<void> {
  const baseUrl = process.env.X_POSTING_ORCHESTRATOR_BASE_URL?.trim();
  const apiKey = process.env.X_POSTING_ORCHESTRATOR_API_KEY?.trim();
  const xAccountId = process.env.X_POSTING_ORCHESTRATOR_ACCOUNT_ID?.trim();
  if (!baseUrl || !apiKey || !xAccountId) {
    throw new Error("Set X_POSTING_ORCHESTRATOR_BASE_URL, X_POSTING_ORCHESTRATOR_API_KEY, and X_POSTING_ORCHESTRATOR_ACCOUNT_ID.");
  }
  const history = await readPublicationHistory({ baseUrl, apiKey, xAccountId });
  process.stdout.write(`${JSON.stringify(history)}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Publication history could not be verified.");
    process.exitCode = 1;
  }
}
