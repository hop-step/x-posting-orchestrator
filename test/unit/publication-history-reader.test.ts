import { describe, expect, it, vi } from "vitest";
import { readPublicationHistory } from "../../scripts/read-publication-history";

const nowMs = Date.UTC(2026, 10, 9);
const oldMs = Date.UTC(2026, 0, 1);
const settings = { baseUrl: "https://history.example.test", apiKey: "test-only", xAccountId: "acc_1", nowMs };

function item(id: string, createdAtMs: number, options: { scheduledAtMs?: number; rootPublishedAtMs?: number; replyAtMs?: number; xAccountId?: string } = {}) {
  return {
    publication: {
      id,
      xAccountId: options.xAccountId ?? "acc_1",
      status: "SCHEDULED",
      createdAtMs,
      scheduledAtMs: options.scheduledAtMs ?? createdAtMs,
      rootPublishedAtMs: options.rootPublishedAtMs ?? null,
      completedAtMs: null,
      request: { content: { text: "History fixture" }, memo: { qa_id: id } }
    },
    plans: options.replyAtMs === undefined ? [] : [{ steps: [{ text: "Reply", publishedAtMs: options.replyAtMs, xPostId: "fixture" }] }]
  };
}

describe("weekly publication history reader", () => {
  it("reads the last page even after a very old creation date and keeps recent events and future reservations", async () => {
    const fetchPage = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({
        publications: [item("pub_5", nowMs), item("pub_4", oldMs, { rootPublishedAtMs: nowMs - 1000 })],
        nextCursor: "page_two"
      }))
      .mockResolvedValueOnce(Response.json({
        publications: [
          item("pub_3", oldMs),
          item("pub_2", oldMs, { scheduledAtMs: nowMs + 1000 }),
          item("pub_1", oldMs, { replyAtMs: nowMs - 1000 })
        ],
        nextCursor: null
      }));
    const result = await readPublicationHistory({ ...settings, fetchPage });
    expect(result).toMatchObject({ complete: true, pages: 2, scannedCount: 5 });
    expect(result.publications.map((bundle) => bundle.publication.id)).toEqual(["pub_5", "pub_4", "pub_2", "pub_1"]);
    const secondRequest = fetchPage.mock.calls[1]?.[0];
    if (typeof secondRequest !== "string") throw new Error("Expected a URL for the second page.");
    const second = new URL(secondRequest);
    expect(second.searchParams.get("cursor")).toBe("page_two");
    expect(second.searchParams.get("xAccountId")).toBe("acc_1");
    expect(second.searchParams.has("statusGroups")).toBe(false);
    expect(fetchPage.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it("does not accept an old server response without nextCursor, even below the cap", async () => {
    const fetchPage = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ publications: [item("pub_1", nowMs)] }));
    await expect(readPublicationHistory({ ...settings, fetchPage })).rejects.toThrow("does not support pagination");
  });

  it.each([
    { name: "HTTP failure", response: () => new Response(null, { status: 503 }), error: "HTTP 503" },
    { name: "repeated cursor", response: () => Response.json({ publications: [item("pub_1", oldMs)], nextCursor: "page_two" }), error: "did not advance" },
    { name: "duplicate ID", response: () => Response.json({ publications: [item("pub_2", oldMs)], nextCursor: null }), error: "scope or order" },
    { name: "wrong account", response: () => Response.json({ publications: [item("pub_1", oldMs, { xAccountId: "acc_other" })], nextCursor: null }), error: "scope or order" },
    { name: "wrong order", response: () => Response.json({ publications: [item("pub_3", nowMs)], nextCursor: null }), error: "scope or order" },
    { name: "empty nonterminal page", response: () => Response.json({ publications: [], nextCursor: "page_three" }), error: "did not advance" }
  ])("refuses partial history after $name", async ({ response, error }) => {
    const fetchPage = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ publications: [item("pub_2", nowMs)], nextCursor: "page_two" }))
      .mockResolvedValueOnce(response());
    await expect(readPublicationHistory({ ...settings, fetchPage })).rejects.toThrow(error);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });
});
