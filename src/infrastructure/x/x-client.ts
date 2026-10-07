import type { PollContent } from "../../domain/publications/entities";

export interface CreatePostInput {
  text: string;
  poll: PollContent | null;
  mediaIds: string[];
  replyToPostId: string | null;
  madeWithAi: boolean;
  accessToken: string | null;
}

export interface ListRecentPostsInput {
  userId: string;
  maxResults: number;
  accessToken: string | null;
}

export interface UploadMediaInput {
  bytes: Uint8Array;
  mimeType: string;
  altText: string | null;
  aiGenerated: boolean;
  accessToken: string | null;
}

export interface UploadMediaSuccess {
  type: "SUCCESS";
  mediaId: string;
}

export interface CreatePostSuccess {
  type: "SUCCESS";
  xPostId: string;
  text: string;
}

export interface RecentPost {
  id: string;
  text: string;
  createdAtMs: number | null;
  referencedPosts: Array<{
    type: string;
    id: string;
  }>;
}

export interface ListRecentPostsSuccess {
  type: "SUCCESS";
  posts: RecentPost[];
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

export type UploadMediaResult =
  | UploadMediaSuccess
  | XRateLimited
  | XDefiniteFailure
  | XDeliveryUnknown;

export type ListRecentPostsResult =
  | ListRecentPostsSuccess
  | XRateLimited
  | XDefiniteFailure
  | XDeliveryUnknown;

export interface XClient {
  uploadMedia(input: UploadMediaInput): Promise<UploadMediaResult>;
  createPost(input: CreatePostInput): Promise<CreatePostResult>;
  listRecentPosts(input: ListRecentPostsInput): Promise<ListRecentPostsResult>;
}
