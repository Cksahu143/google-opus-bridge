import { NexusError } from "./errors";

/**
 * Shared client for the Replicate API — a real, non-Google path to image,
 * music, and video generation, covering models like Flux/SDXL (image),
 * MusicGen/ACE-Step (music), and Stable Video Diffusion (video) behind one
 * token. https://replicate.com/docs/reference/http
 *
 * Auth is a Bearer token read from REPLICATE_API_TOKEN — never hardcoded
 * here, same pattern as github.server.ts and gemini.server.ts. Replicate is
 * pay-as-you-go (no subscription, new accounts get trial credit), which is
 * a real and often cheaper alternative to Vertex AI's allowlist-gated
 * Lyria — but it is still a metered API, not literally free/unlimited.
 */
const BASE = "https://api.replicate.com/v1";

export function replicateToken(): string | undefined {
  const token = process.env["REPLICATE_API_TOKEN"]?.trim();
  return token ? token : undefined;
}

function requireReplicateToken(): string {
  const token = replicateToken();
  if (!token) {
    throw new NexusError(
      "replicate_not_configured",
      "This capability needs a Replicate API token. Create one at https://replicate.com/account/api-tokens and set it as REPLICATE_API_TOKEN in the deployment's environment secrets — never in chat or committed to a repo.",
      503,
    );
  }
  return token;
}

interface ReplicatePrediction {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output: unknown;
  error: string | null;
  urls: { get: string; cancel: string };
}

async function replicateFetch(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${requireReplicateToken()}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

/**
 * Resolves a model's current latest version id (e.g. for "stability-ai/sdxl")
 * so capabilities don't need to hardcode version hashes, which Replicate
 * rotates as models are updated.
 */
export async function resolveLatestVersion(owner: string, name: string): Promise<string> {
  const response = await replicateFetch(`/models/${owner}/${name}`, { method: "GET" });
  const body = (await response.json()) as { latest_version?: { id: string }; detail?: string };
  if (!response.ok || !body.latest_version) {
    throw new NexusError(
      "replicate_model_not_found",
      body.detail ?? `Could not resolve latest version for ${owner}/${name}.`,
      response.ok ? 502 : response.status,
    );
  }
  return body.latest_version.id;
}

export async function replicateRunModel(params: {
  owner: string;
  name: string;
  input: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<unknown> {
  const version = await resolveLatestVersion(params.owner, params.name);
  return replicateRun({
    version,
    input: params.input,
    ...(params.timeoutMs === undefined ? {} : { timeoutMs: params.timeoutMs }),
  });
}

/**
 * Runs a model version to completion and returns its output.
 * Uses `Prefer: wait` to ask Replicate to hold the connection open for up
 * to 60s (avoids a manual polling loop for most short jobs); falls back to
 * polling the prediction's own status URL if it comes back still running.
 */
export async function replicateRun(params: {
  version: string;
  input: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<unknown> {
  const response = await replicateFetch("/predictions", {
    method: "POST",
    headers: { prefer: "wait" },
    body: JSON.stringify({ version: params.version, input: params.input }),
  });
  const body = (await response.json()) as ReplicatePrediction | { detail?: string };
  if (!response.ok) {
    throw new NexusError(
      "replicate_error",
      "detail" in body && body.detail ? body.detail : `Replicate API HTTP ${response.status}`,
      response.status === 401 ? 401 : 502,
    );
  }
  return pollUntilDone(body as ReplicatePrediction, params.timeoutMs ?? 120_000);
}

async function pollUntilDone(prediction: ReplicatePrediction, timeoutMs: number): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  let current = prediction;
  while (
    current.status !== "succeeded" &&
    current.status !== "failed" &&
    current.status !== "canceled"
  ) {
    if (Date.now() > deadline) {
      throw new NexusError(
        "replicate_timeout",
        `Prediction ${current.id} did not finish in time. Check status later at ${current.urls.get}.`,
        504,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const response = await replicateFetch(`/predictions/${current.id}`, { method: "GET" });
    current = (await response.json()) as ReplicatePrediction;
  }
  if (current.status !== "succeeded") {
    throw new NexusError("replicate_prediction_failed", current.error ?? "Prediction failed.", 502);
  }
  return current.output;
}
