import { Hono } from "hono";
import { verifyDiscordRequestSignature } from "../../infrastructure/discord/approval-notifier";
import type { AppBindings } from "../context";

const DISCORD_PING = 1;
const INTERACTION_CALLBACK_PONG = 1;
const INTERACTION_CALLBACK_CHANNEL_MESSAGE = 4;
const EPHEMERAL_FLAG = 64;

interface DiscordInteraction {
  type?: number;
}

export function discordRoutes(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.post("/v1/discord/interactions", async (c) => {
    const body = await c.req.text();
    const publicKey = c.env.DISCORD_PUBLIC_KEY?.trim();
    if (publicKey === undefined || publicKey === "") {
      c.get("logger")?.log("warn", "DISCORD_INTERACTION_PUBLIC_KEY_MISSING", { requestId: c.get("requestId") });
      return c.json(discordEphemeral("Discord連携の公開鍵が未設定です。"), 503);
    }

    const signature = c.req.header("X-Signature-Ed25519") ?? "";
    const timestamp = c.req.header("X-Signature-Timestamp") ?? "";
    const verified = await verifyDiscordRequestSignature({
      publicKeyHex: publicKey,
      signatureHex: signature,
      timestamp,
      body
    });
    if (!verified) {
      return c.text("invalid request signature", 401);
    }

    let interaction: DiscordInteraction;
    try {
      interaction = JSON.parse(body) as DiscordInteraction;
    } catch {
      return c.json(discordEphemeral("Discord InteractionのJSONを読めませんでした。"), 400);
    }

    if (interaction.type === DISCORD_PING) {
      return c.json({ type: INTERACTION_CALLBACK_PONG });
    }
    return c.json(discordEphemeral("Discordからの承認・却下は停止しました。管理画面から操作してください。"));
  });

  return app;
}

function discordEphemeral(content: string): { type: number; data: { content: string; flags: number } } {
  return {
    type: INTERACTION_CALLBACK_CHANNEL_MESSAGE,
    data: {
      content,
      flags: EPHEMERAL_FLAG
    }
  };
}
