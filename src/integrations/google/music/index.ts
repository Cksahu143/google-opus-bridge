import { z } from "zod";

import { base64ToBytes, ensureNexusFolder, saveBinaryToDrive } from "@/lib/nexus/driveAssets.server";
import { NexusError } from "@/lib/nexus/errors";
import { createJob, listJobs, publicJob } from "@/lib/nexus/jobs.server";
import { SCOPES } from "@/lib/nexus/scopes";
import { defineAdapter, defineCapability, type AdapterContext } from "@/lib/nexus/types";

/**
 * Unified Nexus music API. Google's music models (Lyria) are only exposed
 * programmatically through Vertex AI's publisher-model predict endpoint, which
 * authenticates with the user's OAuth token plus a Cloud project — so this
 * adapter calls Vertex directly with the connected account's cloud-platform
 * grant rather than the Gemini API key.
 * https://cloud.google.com/vertex-ai/generative-ai/docs/music/generate-music
 */
const DEFAULT_MUSIC_MODEL = "lyria-002";

function cloudProject(): string {
  const project = process.env["GOOGLE_CLOUD_PROJECT"]?.trim();
  if (!project) {
    throw new NexusError(
      "vertex_not_configured",
      "Music generation runs on Vertex AI, which needs a Google Cloud project. Set GOOGLE_CLOUD_PROJECT and re-connect Google so the cloud-platform permission is granted.",
      503,
    );
  }
  return project;
}

function vertexLocation(): string {
  return process.env["GOOGLE_CLOUD_LOCATION"]?.trim() || "us-central1";
}

interface LyriaResponse {
  predictions?: { bytesBase64Encoded?: string; audioContent?: string; mimeType?: string }[];
}

async function lyriaPredict(
  ctx: AdapterContext,
  params: { model: string; prompt: string; negativePrompt?: string | undefined; count: number; seed?: number | undefined },
) {
  const project = cloudProject();
  const location = vertexLocation();
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${params.model}:predict`;
  const response = await ctx.api<LyriaResponse>(url, {
    body: {
      instances: [
        {
          prompt: params.prompt,
          ...(params.negativePrompt ? { negative_prompt: params.negativePrompt } : {}),
          ...(params.seed === undefined ? {} : { seed: params.seed }),
        },
      ],
      parameters: { sample_count: params.count },
    },
  });
  const tracks = (response.predictions ?? [])
    .map((prediction) => ({
      mimeType: prediction.mimeType ?? "audio/wav",
      base64: prediction.bytesBase64Encoded ?? prediction.audioContent ?? "",
    }))
    .filter((track) => track.base64);
  if (tracks.length === 0) {
    throw new NexusError("music_no_output", "Vertex Lyria returned no audio data.", 502);
  }
  return tracks;
}

export const musicAdapter = defineAdapter({
  service: "music",
  label: "Music generation (Lyria on Vertex AI)",
  description: "Generate instrumental music from a prompt and store the audio in Drive.",
  status: "requires-configuration",
  statusNote:
    "Implemented against Vertex AI's Lyria publisher model using the connected account's cloud-platform grant. It needs GOOGLE_CLOUD_PROJECT plus Vertex AI enabled on that project; Lyria access is allowlisted by Google per project.",
  docsUrl: "https://cloud.google.com/vertex-ai/generative-ai/docs/music/generate-music",
  healthCheck: async (ctx) => {
    const project = process.env["GOOGLE_CLOUD_PROJECT"]?.trim();
    if (!project) return { ok: false, detail: "GOOGLE_CLOUD_PROJECT is not configured" };
    const location = vertexLocation();
    await ctx.api(
      `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${DEFAULT_MUSIC_MODEL}`,
    );
    return { ok: true, detail: `Vertex ${DEFAULT_MUSIC_MODEL} reachable` };
  },
  capabilities: [
    defineCapability({
      id: "music.generate",
      title: "Generate music",
      description:
        "Generate instrumental music from a text prompt. Tracks are saved to Drive and returned as asset links.",
      implementation: "google-rest-api",
      scopes: [SCOPES.cloudPlatform, SCOPES.drive],
      mutating: true,
      input: z.object({
        prompt: z.string().min(1),
        negativePrompt: z.string().optional(),
        count: z.number().int().min(1).max(4).default(1),
        seed: z.number().int().optional(),
        model: z.string().default(DEFAULT_MUSIC_MODEL),
        saveToDrive: z.boolean().default(true),
        driveFolderId: z.string().optional(),
      }),
      run: async (ctx, input) => {
        const tracks = await lyriaPredict(ctx, {
          model: input.model,
          prompt: input.prompt,
          negativePrompt: input.negativePrompt,
          count: input.count,
          seed: input.seed,
        });
        const folderId = input.saveToDrive
          ? (input.driveFolderId ?? (await ensureNexusFolder(ctx, "Google Nexus Generations")))
          : undefined;
        const assets: Record<string, unknown>[] = [];
        for (const [index, track] of tracks.entries()) {
          const bytes = base64ToBytes(track.base64);
          assets.push(
            input.saveToDrive
              ? {
                  ...(await saveBinaryToDrive(ctx, {
                    name: `nexus-music-${Date.now()}-${index + 1}.wav`,
                    mimeType: track.mimeType,
                    data: bytes,
                    folderId,
                  })),
                }
              : { mimeType: track.mimeType, bytes: bytes.length },
          );
        }
        const job = await createJob({
          userId: ctx.userId,
          kind: "music",
          provider: "vertex-ai",
          model: input.model,
          prompt: input.prompt,
          parameters: { count: input.count, seed: input.seed ?? null },
          status: "completed",
          statusDetail: `${assets.length} track(s) generated`,
          result: { tracks: assets },
        });
        return { ...publicJob(job), tracks: assets };
      },
    }),
    defineCapability({
      id: "music.list_jobs",
      title: "List music jobs",
      description: "List recent music generations for the connected account.",
      implementation: "google-rest-api",
      scopes: [],
      input: z.object({ limit: z.number().int().min(1).max(50).default(10) }),
      run: async (ctx, input) => ({
        jobs: (await listJobs(ctx.userId, { kind: "music", limit: input.limit })).map(publicJob),
      }),
    }),
  ],
});

export default musicAdapter;