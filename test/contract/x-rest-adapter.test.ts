import { describe, expect, it } from "vitest";
import { XRestAdapter } from "../../src/infrastructure/x/x-rest-adapter";

describe("XRestAdapter contract mapping", () => {
  it("maps create post, reply, and poll bodies to POST /2/tweets", async () => {
    const requests: { url: string; init: RequestInit | undefined }[] = [];
    const adapter = new XRestAdapter(async (url, init) => {
      requests.push({ url: requestUrl(url), init });
      return new Response(JSON.stringify({ data: { id: "123", text: "ok" } }), { status: 200 });
    });
    await adapter.createPost({
      text: "reply",
      poll: { options: ["A", "B"], durationMinutes: 60 },
      mediaIds: [],
      replyToPostId: "111",
      madeWithAi: false,
      accessToken: "token"
    });
    expect(requests[0]?.url).toBe("https://api.x.com/2/tweets");
    expect(JSON.parse(bodyText(requests[0]?.init?.body))).toMatchObject({
      text: "reply",
      poll: { options: ["A", "B"], duration_minutes: 60 },
      reply: { in_reply_to_tweet_id: "111" }
    });
  });

  it("maps media upload to POST /2/media/upload", async () => {
    const requests: { url: string; init: RequestInit | undefined }[] = [];
    const adapter = new XRestAdapter(async (url, init) => {
      requests.push({ url: requestUrl(url), init });
      return new Response(JSON.stringify({ data: { id: "999" } }), { status: 200 });
    });
    await expect(
      adapter.uploadMedia({
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: "image/png",
        altText: "alt",
        aiGenerated: false,
        accessToken: "token"
      })
    ).resolves.toMatchObject({ type: "SUCCESS", mediaId: "999" });
    expect(requests[0]?.url).toBe("https://api.x.com/2/media/upload");
    expect(JSON.parse(bodyText(requests[0]?.init?.body))).toMatchObject({
      media_category: "tweet_image",
      media_type: "image/png"
    });
  });

  it("classifies 429 and 5xx without automatic retrying the request", async () => {
    const rate = new XRestAdapter(async () => new Response(JSON.stringify({ title: "rate" }), { status: 429, headers: { "x-rate-limit-reset": "1782097200" } }));
    await expect(
      rate.createPost({ text: "hello", poll: null, mediaIds: [], replyToPostId: null, madeWithAi: false, accessToken: "token" })
    ).resolves.toMatchObject({ type: "RATE_LIMITED", retryAtMs: 1782097200000 });

    const serverError = new XRestAdapter(async () => new Response("oops", { status: 500 }));
    await expect(
      serverError.createPost({ text: "hello", poll: null, mediaIds: [], replyToPostId: null, madeWithAi: false, accessToken: "token" })
    ).resolves.toMatchObject({ type: "DELIVERY_UNKNOWN" });
  });
});

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function bodyText(body: BodyInit | null | undefined): string {
  if (typeof body === "string") {
    return body;
  }
  throw new Error("Expected string request body.");
}
