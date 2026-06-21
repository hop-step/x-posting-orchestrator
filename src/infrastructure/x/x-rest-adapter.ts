import { classifyCreatePostResponse, classifyNetworkError } from "./error-classifier";
import type { CreatePostInput, CreatePostResult, XClient } from "./x-client";

export class XRestAdapter implements XClient {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

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

function buildCreatePostBody(input: CreatePostInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    text: input.text
  };
  if (input.replyToPostId !== null) {
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
