import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const PEPPER_SECRET_NAME = "API_KEY_PEPPER";
const LOCAL_PEPPER_PATH = resolve(".secrets/api-key-pepper");

export interface ApiKeyPepperResult {
  pepper: string;
  source: "env" | "local-file" | "generated";
  generated: boolean;
  syncedToCloudflare: boolean;
}

export interface ApiKeyPepperOptions {
  allowInit: boolean;
  syncCloudflareSecret: boolean;
  persistEnvToLocalFile?: boolean;
}

export function ensureApiKeyPepper(options: ApiKeyPepperOptions): ApiKeyPepperResult {
  const envPepper = process.env.API_KEY_PEPPER?.trim();
  if (envPepper) {
    validatePepper(envPepper, "API_KEY_PEPPER");
    if (options.persistEnvToLocalFile === true) {
      persistEnvPepper(envPepper);
    }
    const syncedToCloudflare = options.syncCloudflareSecret ? ensureRemoteSecret(envPepper) : false;
    return {
      pepper: envPepper,
      source: "env",
      generated: false,
      syncedToCloudflare
    };
  }

  if (existsSync(LOCAL_PEPPER_PATH)) {
    const filePepper = readFileSync(LOCAL_PEPPER_PATH, "utf8").trim();
    validatePepper(filePepper, LOCAL_PEPPER_PATH);
    const syncedToCloudflare = options.syncCloudflareSecret ? ensureRemoteSecret(filePepper) : false;
    return {
      pepper: filePepper,
      source: "local-file",
      generated: false,
      syncedToCloudflare
    };
  }

  if (!options.allowInit) {
    throw new Error(
      [
        "API_KEY_PEPPER is not available.",
        "Set API_KEY_PEPPER, or run `pnpm init-api-key-pepper` once to generate .secrets/api-key-pepper and configure the Cloudflare secret."
      ].join(" ")
    );
  }

  if (!options.syncCloudflareSecret) {
    throw new Error("Refusing to initialize API_KEY_PEPPER without Cloudflare sync. Use `pnpm init-api-key-pepper`, or pass API_KEY_PEPPER explicitly.");
  }

  if (remoteSecretExists()) {
    throw new Error(
      [
        "Cloudflare already has API_KEY_PEPPER, but no local value was found.",
        "The secret value cannot be read back from Cloudflare, so this script will not overwrite it.",
        "Set API_KEY_PEPPER from your password manager or create .secrets/api-key-pepper with the existing value."
      ].join(" ")
    );
  }

  const generatedPepper = randomBytes(32).toString("hex");
  writeLocalPepper(generatedPepper);
  uploadRemoteSecret(generatedPepper);
  return {
    pepper: generatedPepper,
    source: "generated",
    generated: true,
    syncedToCloudflare: true
  };
}

export function localPepperPath(): string {
  return LOCAL_PEPPER_PATH;
}

function validatePepper(pepper: string, source: string): void {
  if (pepper.length < 32) {
    throw new Error(`${source} is too short. Use at least 32 random bytes; 64 hex characters is recommended.`);
  }
}

function writeLocalPepper(pepper: string): void {
  mkdirSync(dirname(LOCAL_PEPPER_PATH), { recursive: true, mode: 0o700 });
  writeFileSync(LOCAL_PEPPER_PATH, `${pepper}\n`, { flag: "wx", mode: 0o600 });
  chmodSync(LOCAL_PEPPER_PATH, 0o600);
}

function persistEnvPepper(pepper: string): void {
  if (!existsSync(LOCAL_PEPPER_PATH)) {
    writeLocalPepper(pepper);
    return;
  }
  const existingPepper = readFileSync(LOCAL_PEPPER_PATH, "utf8").trim();
  if (existingPepper !== pepper) {
    throw new Error(`${LOCAL_PEPPER_PATH} already exists and does not match API_KEY_PEPPER. Refusing to overwrite it.`);
  }
}

function ensureRemoteSecret(value: string): boolean {
  if (remoteSecretExists()) {
    return false;
  }
  uploadRemoteSecret(value);
  return true;
}

function remoteSecretExists(): boolean {
  const output = runWrangler(["secret", "list", "--format", "json"]);
  const secrets = JSON.parse(output) as Array<{ name?: unknown }>;
  return secrets.some((secret) => secret.name === PEPPER_SECRET_NAME);
}

function uploadRemoteSecret(value: string): void {
  runWrangler(["secret", "put", PEPPER_SECRET_NAME], value);
}

function runWrangler(args: string[], input?: string): string {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(command, ["wrangler", ...args], {
    cwd: process.cwd(),
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"]
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const details = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n");
    throw new Error(`wrangler ${args.join(" ")} failed.${details ? `\n${details}` : ""}`);
  }
  return result.stdout;
}
