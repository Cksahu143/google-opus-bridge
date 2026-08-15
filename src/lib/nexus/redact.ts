const SENSITIVE_KEY = /(token|secret|password|authorization|credential|api[_-]?key|cookie)/i;
const TOKEN_LIKE = /\b(ya29\.[\w.-]+|1\/\/[\w.-]{20,}|sb_secret_[\w-]+|eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{5,})\b/g;

/** Strip token-shaped values before anything is logged or shown. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (typeof value === "string") {
    const masked = value.replace(TOKEN_LIKE, "[redacted]");
    return masked.length > 2000 ? `${masked.slice(0, 2000)}…` : masked;
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function redactMessage(message: string): string {
  return String(redact(message));
}