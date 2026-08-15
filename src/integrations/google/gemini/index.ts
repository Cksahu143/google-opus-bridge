import { z } from "zod";

import { NexusError } from "@/lib/nexus/errors";
import { defineAdapter, defineCapability } from "@/lib/nexus/types";
import { unavailableCapability } from "@/lib/nexus/unsupported";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Gemini API (Google AI Studio keys). This is a separate credential from the
 * user's Google OAuth grant: the Gemini API authenticates with an API key,
 * not with Workspace OAuth scopes.
 * https://ai.google.dev/api
 */
export function geminiApiKey(): string | undefined {
  return process.env["GOOGLE_AI_API_KEY"];
}

function requireKey(): string {
  const key = geminiApiKey();
  if (!key) {
    throw new NexusError(
      "gemini_not_configured",
      "Gemini is not configured. Add a Google AI Studio API key as GOOGLE_AI_API_KEY.",
      503,
    );
  }
  return key;
}

async function generate(model: string, body: unknown) {
  const response = await fetch(`${BASE}/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": requireKey() },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const message =
      (payload["error"] as { message?: string } | undefined)?.message ?? `HTTP ${response.status}`;
    throw new NexusError("gemini_error", message, 502);
  }
  return payload as {
    candidates?: { content?: { parts?: { text?: string; inlineData?: { mimeType: string; data: string } }[] } }[];
  };
}

export const geminiAdapter = defineAdapter({
  service: "gemini",
  label: "Gemini (Google AI Studio)",
  description: "Text and image generation through the official Gemini API.",
  status: geminiApiKey() ? "supported" : "requires-configuration",
  statusNote: geminiApiKey()
    ? "Official Gemini API with a Google AI Studio key."
    : "Adapter implemented, but it needs a Google AI Studio API key (GOOGLE_AI_API_KEY). Gemini uses an API key, not Workspace OAuth.",
  docsUrl: "https://ai.google.dev/api",
  requiresGoogleAuth: false,
  healthCheck: async () => {
    const response = await fetch(`${BASE}/models`, {
      headers: { "x-goog-api-key": requireKey() },
    });
    if (!response.ok) throw new NexusError("gemini_error", `Gemini API: ${response.status}`, 502);
    return { ok: true, detail: "Gemini API reachable" };
  },
  capabilities: [
    defineCapability({
      id: "gemini.generate_text",
      title: "Generate text with Gemini",
      description: "Run a prompt through a Gemini model and return the generated text.",
      implementation: "gemini-api",
      scopes: [],
      input: z.object({
        prompt: z.string().min(1),
        model: z.string().default("gemini-2.5-flash"),
        systemInstruction: z.string().optional(),
      }),
      run: async (_ctx, input) => {
        const result = await generate(input.model, {
          contents: [{ role: "user", parts: [{ text: input.prompt }] }],
          ...(input.systemInstruction
            ? { systemInstruction: { parts: [{ text: input.systemInstruction }] } }
            : {}),
        });
        const text = (result.candidates?.[0]?.content?.parts ?? [])
          .map((part) => part.text ?? "")
          .join("");
        return { model: input.model, text };
      },
    }),
    defineCapability({
      id: "gemini.generate_image",
      title: "Generate an image with Gemini",
      description:
        "Generate an image from a prompt. Returns base64 image data that other capabilities (e.g. Drive upload) can consume.",
      implementation: "gemini-api",
      scopes: [],
      input: z.object({
        prompt: z.string().min(1),
        model: z.string().default("gemini-2.5-flash-image"),
      }),
      run: async (_ctx, input) => {
        const result = await generate(input.model, {
          contents: [{ role: "user", parts: [{ text: input.prompt }] }],
        });
        const image = (result.candidates?.[0]?.content?.parts ?? []).find(
          (part) => part.inlineData,
        )?.inlineData;
        if (!image) throw new NexusError("gemini_no_image", "Gemini returned no image data", 502);
        return { model: input.model, mimeType: image.mimeType, base64Length: image.data.length, base64: image.data };
      },
    }),
    unavailableCapability({
      id: "gemini.generate_video",
      title: "Generate video with Veo",
      description: "Generate video from a prompt with Veo.",
      implementation: "gemini-api",
      reason:
        "Veo generation on the Gemini API is a long-running operation (predictLongRunning + polling) that outlives a synchronous connector call. The adapter reserves this id for an async job implementation.",
    }),
    unavailableCapability({
      id: "gemini.generate_music",
      title: "Generate music",
      description: "Generate music from a prompt.",
      reason:
        "Google's music models (Lyria) are not exposed on the public Gemini API for general API keys; only Vertex AI allowlisted access exists today.",
    }),
  ],
});

export default geminiAdapter;