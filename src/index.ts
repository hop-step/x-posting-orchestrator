import { createApp } from "./http/app";
import type { Env } from "./env";

const app = createApp();

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    return app.fetch(request, env, ctx);
  },

  async scheduled(): Promise<void> {
    // Implemented in Phase 3.
  },

  async queue(): Promise<void> {
    // Implemented in Phase 3.
  }
};
