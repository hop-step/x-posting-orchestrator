import { classifyCreatePostResponse, classifyNetworkError } from "./error-classifier";
import type { CreatePostInput, CreatePostResult, UploadMediaInput, UploadMediaResult, XClient } from "./x-client";

type Fetcher = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response>;

export class XRestAdapter implements XClient {
  private readonly fetcher: Fetcher;

  constructor(fetcher?: Fetcher) {
    this.fetcher = fetcher ?? ((input, init) => fetch(input, init));
  }

  async uploadMedia(input: UploadMediaInput): Promise<UploadMediaResult> {
    if (input.accessToken === null) {
      return {
        type: "DEFINITE_FAILURE",
        httpStatus: 401,
        errorCode: "X_ACCESS_TOKEN_MISSING",
        error: { message: "Missing X access token." }
      };
    }
    try {
      const response = await this.fetcher("https://api.x.com/2/media/upload", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          media: bytesToBase64(input.bytes),
          media_category: "tweet_image",
          media_type: input.mimeType
        })
      });
      const body = await safeJson(response);
      if (response.ok) {
        const mediaId = extractMediaId(body);
        if (mediaId !== null) {
          return { type: "SUCCESS", mediaId };
        }
        return { type: "DELIVERY_UNKNOWN", errorCode: "X_MEDIA_RESPONSE_MISSING_ID", error: body };
      }
      const classified = classifyCreatePostResponse(response, body, Date.now());
      if (classified.type === "SUCCESS") {
        return { type: "DELIVERY_UNKNOWN", errorCode: "X_MEDIA_UNEXPECTED_POST_RESPONSE", error: body };
      }
      if (classified.type === "FALLBACK_ELIGIBLE") {
        return { type: "DEFINITE_FAILURE", httpStatus: classified.httpStatus, errorCode: classified.errorCode, error: classified.error };
      }
      return classified;
    } catch (error) {
      return classifyNetworkError(error);
    }
  }

  async createPost(input: CreatePostInput): Promise<CreatePostResult> {
    if (input.accessToken === null) {
      return {
        type: "DEFINITE_FAILURE",
        httpStatus: 401,
        errorCode: "X_ACCESS_TOKEN_MISSING",
        error: { message: "Missing X access token." }
      };
    }
    const body = buildCreatePostBody(input);
    try {
      const response = await this.fetcher("https://api.x.com/2/tweets", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });
      const responseBody = await safeJson(response);
      return classifyCreatePostResponse(response, responseBody, Date.now());
    } catch (error) {
      return classifyNetworkError(error);
    }
  }
}

function extractMediaId(body: unknown): string | null {
  if (body !== null && typeof body === "object" && "data" in body) {
    const data = (body as { data?: unknown }).data;
    if (data !== null && typeof data === "object") {
      const id = (data as { id?: unknown; media_id_string?: unknown }).id ?? (data as { media_id_string?: unknown }).media_id_string;
      return typeof id === "string" ? id : null;
    }
  }
  return null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function buildCreatePostBody(input: CreatePostInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    text: input.text
  };
  if (input.replyToPostId !== null && input.replyToPostId !== undefined) {
    body.reply = {
      in_reply_to_tweet_id: input.replyToPostId
    };
  }
  if (input.poll !== null) {
    body.poll = {
      options: input.poll.options,
      duration_minutes: input.poll.durationMinutes
    };
  }
  if (input.mediaIds.length > 0) {
    body.media = {
      media_ids: input.mediaIds
    };
  }
  if (input.madeWithAi) {
    body.made_with_ai = true;
  }
  return body;
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {
      unparseable: true,
      status: response.status
    };
  }
}
