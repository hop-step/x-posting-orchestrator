export type LogLevel = "debug" | "info" | "warn" | "error";

const SECRET_KEYS = new Set(["authorization", "cookie", "token", "accessToken", "refreshToken", "oauthCode", "code"]);

export interface Logger {
  log(level: LogLevel, event: string, fields?: Record<string, unknown>): void;
}

export const consoleLogger: Logger = {
  log(level, event, fields = {}) {
    const payload = {
      level,
      event,
      ...(redact(fields) as Record<string, unknown>)
    };
    console.log(JSON.stringify(payload));
  }
};

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      result[key] = SECRET_KEYS.has(key) || key.toLowerCase().includes("token") ? "[REDACTED]" : redact(child);
    }
    return result;
  }
  return value;
}
