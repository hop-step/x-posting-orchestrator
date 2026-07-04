import { ensureApiKeyPepper, localPepperPath } from "./api-key-pepper";

try {
  const result = ensureApiKeyPepper({
    allowInit: true,
    syncCloudflareSecret: true,
    persistEnvToLocalFile: true
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        localPath: localPepperPath(),
        source: result.source,
        generated: result.generated,
        syncedToCloudflare: result.syncedToCloudflare,
        note: "The API_KEY_PEPPER value is intentionally not printed."
      },
      null,
      2
    )
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`init-api-key-pepper failed: ${message}`);
  process.exit(1);
}
