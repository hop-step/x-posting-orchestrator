import type { CreatePostInput, CreatePostResult, XClient } from "./x-client";

export class FakeXAdapter implements XClient {
  readonly calls: CreatePostInput[] = [];
  private nextPostId = 1;

  constructor(private readonly outcomes: CreatePostResult[] = []) {}

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
