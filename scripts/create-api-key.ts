import { digestApiKey } from "../src/domain/auth/api-keys";
import { randomHex } from "../src/shared/ids";

const pepper = process.env.API_KEY_PEPPER;
const actorType = process.argv[2] ?? "SERVICE";
const clientName = process.argv[3] ?? "local-client";

if (!pepper) {
  throw new Error("Set API_KEY_PEPPER before running this script.");
}

const prefix = `xps_${randomHex(6)}`;
const secret = randomHex(32);
const fullKey = `${prefix}.${secret}`;
const digest = await digestApiKey(pepper, fullKey);

console.log(JSON.stringify({ clientName, actorType, apiKey: fullKey, keyPrefix: prefix, keyDigest: digest }, null, 2));
