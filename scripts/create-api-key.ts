import { digestApiKey } from "../src/domain/auth/api-keys";
import { randomHex } from "../src/shared/ids";
import { ensureApiKeyPepper } from "./api-key-pepper";

try {
  const positional = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  const flags = new Set(process.argv.slice(2).filter((arg) => arg.startsWith("--")));
  const actorType = positional[0] ?? "SERVICE";
  const clientName = positional[1] ?? "local-client";
  const initPepper = flags.has("--init-pepper");

  const pepperResult = ensureApiKeyPepper({
    allowInit: initPepper,
    syncCloudflareSecret: initPepper
  });

  const prefix = `xps_${randomHex(6)}`;
  const secret = randomHex(32);
  const fullKey = `${prefix}.${secret}`;
  const digest = await digestApiKey(pepperResult.pepper, fullKey);

  console.log(
    JSON.stringify(
      {
        clientName,
        actorType,
        apiKey: fullKey,
        keyPrefix: prefix,
        keyDigest: digest,
        apiKeyPepper: {
          source: pepperResult.source,
          generated: pepperResult.generated,
          syncedToCloudflare: pepperResult.syncedToCloudflare
        }
      },
      null,
      2
    )
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`create-api-key failed: ${message}`);
  process.exit(1);
}
