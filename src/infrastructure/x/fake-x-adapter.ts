import type { CreatePostInput, CreatePostResult, ListRecentPostsInput, ListRecentPostsResult, UploadMediaInput, UploadMediaResult, XClient } from "./x-client";

export class FakeXAdapter implements XClient {
  readonly calls: CreatePostInput[] = [];
  readonly mediaUploads: UploadMediaInput[] = [];
  readonly recentPostLookups: ListRecentPostsInput[] = [];
  private nextPostId = 1;
  private nextMediaId = 1;

  constructor(
    private readonly outcomes: CreatePostResult[] = [],
    private readonly mediaOutcomes: UploadMediaResult[] = [],
    private readonly recentPostOutcomes: ListRecentPostsResult[] = []
  ) {}

  async uploadMedia(input: UploadMediaInput): Promise<UploadMediaResult> {
    this.mediaUploads.push(input);
    const scripted = this.mediaOutcomes.shift();
    if (scripted !== undefined) {
      return scripted;
    }
    return {
      type: "SUCCESS",
      mediaId: `xmedia_${this.nextMediaId++}`
    };
  }

  async createPost(input: CreatePostInput): Promise<CreatePostResult> {
    this.calls.push(input);
    const scripted = this.outcomes.shift();
    if (scripted !== undefined) {
      return scripted;
    }
    const id = (this.nextPostId++).toString().padStart(10, "0");
    return {
      type: "SUCCESS",
      xPostId: id,
      text: input.text
    };
  }

  async listRecentPosts(input: ListRecentPostsInput): Promise<ListRecentPostsResult> {
    this.recentPostLookups.push(input);
    const scripted = this.recentPostOutcomes.shift();
    if (scripted !== undefined) {
      return scripted;
    }
    return {
      type: "SUCCESS",
      posts: []
    };
  }
}
