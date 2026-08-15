import { getAccessToken } from "./connections.server";
import { NexusError } from "./errors";
import { redactMessage } from "./redact";
import type { AdapterContext } from "./types";

function mapGoogleError(status: number, payload: unknown): NexusError {
  const message =
    (payload as { error?: { message?: string } })?.error?.message ??
    (typeof payload === "string" ? payload : "Google returned an error");
  if (status === 401)
    return new NexusError("google_unauthorized", "Google rejected the credentials.", 401);
  if (status === 403)
    return new NexusError("google_forbidden", redactMessage(message), 403);
  if (status === 404) return new NexusError("google_not_found", redactMessage(message), 404);
  if (status === 429)
    return new NexusError("google_rate_limited", "Google rate limit reached.", 429);
  return new NexusError("google_error", redactMessage(message), status >= 500 ? 502 : 400);
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/**
 * Builds an adapter context bound to one user's Google grant. Tokens live only
 * inside this closure — adapters (and therefore Claude) never see them.
 */
export async function createAdapterContext(userId: string): Promise<AdapterContext> {
  const token = await getAccessToken(userId);

  const raw = async (url: string, init: RequestInit = {}) => {
    let lastResponse: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const headers = new Headers(init.headers);
      headers.set("authorization", `Bearer ${token}`);
      const response = await fetch(url, { ...init, headers });
      if (!RETRYABLE.has(response.status)) return response;
      lastResponse = response;
      await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
    }
    return lastResponse as Response;
  };

  const api = async <T,>(
    url: string,
    init: {
      method?: string | undefined;
      body?: unknown;
      headers?: Record<string, string> | undefined;
    } = {},
  ): Promise<T> => {
    const response = await raw(url, {
      method: init.method ?? (init.body ? "POST" : "GET"),
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    const text = await response.text();
    const payload: unknown = text ? safeJson(text) : null;
    if (!response.ok) throw mapGoogleError(response.status, payload);
    return payload as T;
  };

  return { userId, api, raw };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}