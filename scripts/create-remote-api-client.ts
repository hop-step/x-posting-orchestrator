const DEFAULT_BASE_URL = "https://x-posting-orchestrator.watapyon117.workers.dev";

interface CliOptions {
  actorType: string;
  name: string;
  xAccountId: string;
  baseUrl: string;
  apiKey: string;
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.actorType !== "AI") {
    throw new Error("Only AI clients are supported by this command.");
  }

  const response = await fetch(`${options.baseUrl.replace(/\/$/u, "")}/v1/api-clients/ai`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: options.name,
      xAccountId: options.xAccountId
    })
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`API returned ${response.status}: ${JSON.stringify(body)}`);
  }
  console.log(JSON.stringify(body, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`create-remote-api-client failed: ${message}`);
  process.exit(1);
}

function parseArgs(args: string[]): CliOptions {
  const positional: string[] = [];
  const values = new Map<string, string>();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const next = args[index + 1];
    if (next === undefined || next.startsWith("--")) {
      throw new Error(`${arg} requires a value.`);
    }
    values.set(arg, next);
    index += 1;
  }

  const actorType = positional[0];
  const name = positional[1];
  const xAccountId = values.get("--x-account-id");
  const apiKey = values.get("--api-key") ?? process.env.X_POSTING_ADMIN_API_KEY ?? process.env.X_POSTING_API_KEY;

  if (actorType === undefined || name === undefined) {
    throw new Error('Usage: pnpm create-remote-api-client AI "client-name" --x-account-id acc_xxx --api-key <admin-api-key>');
  }
  if (xAccountId === undefined) {
    throw new Error("--x-account-id is required.");
  }
  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new Error("--api-key or X_POSTING_ADMIN_API_KEY is required. Use an existing HUMAN/SERVICE key with account:manage.");
  }

  return {
    actorType,
    name,
    xAccountId,
    baseUrl: values.get("--base-url") ?? process.env.X_POSTING_API_BASE_URL ?? DEFAULT_BASE_URL,
    apiKey
  };
}

export {};
