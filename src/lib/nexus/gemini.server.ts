import { NexusError } from "./errors";

/**
 * Shared client for the Gemini API (Google AI Studio keys) — the documented
 * programmatic surface for Gemini text, Gemini image, Imagen and Veo models.
 * https://ai.google.dev/api
 *
 * This credential is deliberately separate from the user's Workspace OAuth
 * grant: Google authenticates these models with an API key, not with OAuth
 * scopes, so no Workspace permission can ever unlock them.
 */
export const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

export function geminiApiKey(): string | undefined {
  const key = process.env["GOOGLE_AI_API_KEY"]?.trim();
  return key ? key : undefined;
}

export function requireGeminiKey(): string {
  const key = geminiApiKey();
  if (!key) {
    throw new NexusError(
      "gemini_not_configured",
      "This capability runs on the Gemini API, which needs a Google AI Studio API key. Add GOOGLE_AI_API_KEY in the Nexus dashboard settings.",
      503,
    );
  }
  return key;
}

export async function geminiFetch(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  return fetch(`${GEMINI_BASE}/${path.replace(/^\//, "")}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { "content-type": "application/json", "x-goog-api-key": requireGeminiKey() },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

export async function geminiJson<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await geminiFetch(path, init);
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    const message =
      (payload as { error?: { message?: string } } | null)?.error?.message ??
      (typeof payload === "string" && payload ? payload : `Gemini API HTTP ${response.status}`);
    throw new NexusError("gemini_error", message, response.status === 429 ? 429 : 502);
  }
  return payload as T;
}

export interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

export interface GeminiGenerateResponse {
  candidates?: { content?: { parts?: GeminiPart[] } }[];
}

export async function geminiGenerateContent(
  model: string,
  body: Record<string, unknown>,
): Promise<GeminiGenerateResponse> {
  return geminiJson<GeminiGenerateResponse>(`models/${model}:generateContent`, { body });
}

export function collectText(response: GeminiGenerateResponse): string {
  return (response.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim();
}

export function collectInlineImages(
  response: GeminiGenerateResponse,
): { mimeType: string; data: string }[] {
  return (response.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.inlineData)
    .filter((data): data is { mimeType: string; data: string } => Boolean(data));
}

/** Long-running operation shape used by Veo (predictLongRunning). */
export interface GeminiOperation {
  name: string;
  done?: boolean;
  error?: { message?: string };
  response?: Record<string, unknown>;
}

export async function getGeminiOperation(name: string): Promise<GeminiOperation> {
  return geminiJson<GeminiOperation>(name.replace(/^\//, ""));
}