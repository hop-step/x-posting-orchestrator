import type { CreatePostInput, CreatePostResult, UploadMediaInput, UploadMediaResult, XClient } from "./x-client";

export class FakeXAdapter implements XClient {
  readonly calls: CreatePostInput[] = [];
  readonly mediaUploads: UploadMediaInput[] = [];
  private nextPostId = 1;
  private nextMediaId = 1;

  constructor(
    private readonly outcomes: CreatePostResult[] = [],
    private readonly mediaOutcomes: UploadMediaResult[] = []
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
}
