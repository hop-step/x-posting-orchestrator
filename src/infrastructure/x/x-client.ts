import type { PollContent } from "../../domain/publications/entities";

export interface CreatePostInput {
  text: string;
  poll: PollContent | null;
  mediaIds: string[];
  replyToPostId: string | null;
  madeWithAi: boolean;
  accessToken: string | null;
}

export interface CreatePostSuccess {
  type: "SUCCESS";
  xPostId: string;
  text: string;
}

export interface XRateLimited {
  type: "RATE_LIMITED";
  retryAtMs: number;
  httpStatus: 429;
  errorCode: string;
  error: unknown;
}

export interface XDefiniteFailure {
  type: "DEFINITE_FAILURE";
  httpStatus: number;
  errorCode: string;
  error: unknown;
}

export interface XFallbackEligibleFailure {
  type: "FALLBACK_ELIGIBLE";
  httpStatus: number;
  errorCode: string;
  error: unknown;
}

export interface XDeliveryUnknown {
  type: "DELIVERY_UNKNOWN";
  errorCode: string;
  error: unknown;
}

export type CreatePostResult =
  | CreatePostSuccess
  | XRateLimited
  | XDefiniteFailure
  | XFallbackEligibleFailure
  | XDeliveryUnknown;

export interface XClient {
  createPost(input: CreatePostInput): Promise<CreatePostResult>;
}
