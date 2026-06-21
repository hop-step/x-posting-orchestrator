import type { CreatePostResult } from "./x-client";

export function classifyCreatePostResponse(response: Response, body: unknown, nowMs: number): CreatePostResult {
  if (response.ok) {
    const postId = extractPostId(body);
    if (postId !== null) {
      return {
        type: "SUCCESS",
        xPostId: postId,
        text: extractText(body)
      };
    }
    return {
      type: "DELIVERY_UNKNOWN",
      errorCode: "X_RESPONSE_MISSING_POST_ID",
      error: body
    };
  }

  if (response.status === 429) {
    return {
      type: "RATE_LIMITED",
      retryAtMs: parseRateLimitReset(response.headers, nowMs),
      httpStatus: 429,
      errorCode: "X_RATE_LIMITED",
      error: body
    };
  }

  if (isFallbackEligible(body)) {
    return {
      type: "FALLBACK_ELIGIBLE",
      httpStatus: response.status,
      errorCode: "X_LONGFORM_FALLBACK_ELIGIBLE",
      error: body
    };
  }

  if ([400, 401, 403, 404, 422].includes(response.status)) {
    return {
      type: "DEFINITE_FAILURE",
      httpStatus: response.status,
      errorCode: `X_HTTP_${response.status}`,
      error: body
    };
  }

  return {
    type: "DELIVERY_UNKNOWN",
    errorCode: `X_HTTP_${response.status}`,
    error: body
  };
}

export function classifyNetworkError(error: unknown): CreatePostResult {
  return {
    type: "DELIVERY_UNKNOWN",
    errorCode: "X_NETWORK_UNKNOWN",
    error: serializeError(error)
  };
}

function extractPostId(body: unknown): string | null {
  if (body !== null && typeof body === "object" && "data" in body) {
    const data = (body as { data?: unknown }).data;
    if (data !== null && typeof data === "object" && "id" in data) {
      const id = (data as { id?: unknown }).id;
      return typeof id === "string" ? id : null;
    }
  }
  return null;
}

function extractText(body: unknown): string {
  if (body !== null && typeof body === "object" && "data" in body) {
    const data = (body as { data?: unknown }).data;
    if (data !== null && typeof data === "object" && "text" in data) {
      const text = (data as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    }
  }
  return "";
}

function parseRateLimitReset(headers: Headers, nowMs: number): number {
  const reset = headers.get("x-rate-limit-reset");
  if (reset !== null) {
    const seconds = Number(reset);
    if (Number.isFinite(seconds) && seconds > 0) {
      return seconds * 1000;
    }
  }
  return nowMs + 15 * 60 * 1000 + Math.floor(Math.random() * 30_000);
}

function isFallbackEligible(body: unknown): boolean {
  const text = JSON.stringify(body).toLowerCase();
  return text.includes("longform") || text.includes("not eligible") || text.includes("too long") || text.includes("character");
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message
    };
  }
  return {
    message: String(error)
  };
}
