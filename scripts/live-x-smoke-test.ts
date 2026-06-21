if (process.env.LIVE_X_TEST !== "true") {
  console.log("LIVE_X_TEST is not true; skipping live X smoke test.");
  process.exit(0);
}

const required = ["X_TEST_ACCOUNT_ID", "PUBLIC_BASE_URL"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  throw new Error(`Missing live smoke test environment variables: ${missing.join(", ")}`);
}

console.log("Live smoke test entrypoint is configured. Use README steps to run against a test X account only.");
