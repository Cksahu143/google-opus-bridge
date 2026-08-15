import { z } from "zod";

import { base64ToBytes, ensureNexusFolder, saveBinaryToDrive } from "@/lib/nexus/driveAssets.server";
import { NexusError } from "@/lib/nexus/errors";
import {
  geminiApiKey,
  geminiFetch,
  geminiJson,
  getGeminiOperation,
  requireGeminiKey,
  type GeminiOperation,
} from "@/lib/nexus/gemini.server";
import { createJob, getJob, publicJob, updateJob } from "@/lib/nexus/jobs.server";
import { defineAdapter, defineCapability, type AdapterContext } from "@/lib/nexus/types";

/**
 * Unified Nexus video API over Veo on the Gemini API. Veo generation is a
 * long-running operation (`:predictLongRunning` + operation polling), which
 * cannot complete inside one synchronous connector call — so Nexus wraps it in
 * its own async job: `video.generate` returns a jobId immediately and
 * `video.status` resolves it, persisting the finished clip to Drive.
 * https://ai.google.dev/gemini-api/docs/video
 */
const DEFAULT_VEO_MODEL = "veo-3.0-generate-001";

interface VeoOperationResponse {
  generateVideoResponse?: {
    generatedSamples?: { video?: { uri?: string } }[];
  };
  generatedVideos?: { video?: { uri?: string } }[];
  predictions?: { bytesBase64Encoded?: string; mimeType?: string }[];
}

function videoUris(operation: GeminiOperation): string[] {
  const response = (operation.response ?? {}) as VeoOperationResponse;
  const samples = [
    ...(response.generateVideoResponse?.generatedSamples ?? []),
    ...(response.generatedVideos ?? []),
  ];
  return samples.map((sample) => sample.video?.uri).filter((uri): uri is string => Boolean(uri));
}

function inlineVideos(operation: GeminiOperation) {
  const response = (operation.response ?? {}) as VeoOperationResponse;
  return (response.predictions ?? [])
    .filter((prediction) => prediction.bytesBase64Encoded)
    .map((prediction) => ({
      mimeType: prediction.mimeType ?? "video/mp4",
      base64: prediction.bytesBase64Encoded as string,
    }));
}

async function downloadVeoFile(uri: string): Promise<Uint8Array> {
  const url = uri.startsWith("http")
    ? uri
    : `https://generativelanguage.googleapis.com/v1beta/${uri.replace(/^\//, "")}`;
  const response = await fetch(url, { headers: { "x-goog-api-key": requireGeminiKey() } });
  if (!response.ok) {
    throw new NexusError(
      "video_download_failed",
      `Could not download the generated video (HTTP ${response.status}).`,
      502,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** Polls one Veo job once and, when finished, stores the clip in Drive. */
async function resolveJob(ctx: AdapterContext, jobId: string) {
  const job = await getJob(ctx.userId, jobId);
  if (!job) throw new NexusError("job_not_found", `No video job ${jobId} for this account.`, 404);
  if (job.status === "completed" || job.status === "failed") return publicJob(job);
  if (!job.operation_name) {
    return publicJob(await updateJob(job.id, { status: "failed", errorMessage: "No operation id" }));
  }

  const operation = await getGeminiOperation(job.operation_name);
  if (!operation.done) {
    return publicJob(
      await updateJob(job.id, { status: "running", statusDetail: "Veo is still rendering" }),
    );
  }
  if (operation.error) {
    return publicJob(
      await updateJob(job.id, {
        status: "failed",
        errorMessage: operation.error.message ?? "Veo reported an error",
      }),
    );
  }

  const saveToDrive = job.parameters["saveToDrive"] !== false;
  const folderId = (job.parameters["driveFolderId"] as string | undefined) ?? undefined;
  const clips: Record<string, unknown>[] = [];

  const uris = videoUris(operation);
  const inline = inlineVideos(operation);
  if (uris.length === 0 && inline.length === 0) {
    return publicJob(
      await updateJob(job.id, {
        status: "failed",
        errorMessage: "Veo finished but returned no video output.",
      }),
    );
  }

  const targetFolder = saveToDrive
    ? (folderId ?? (await ensureNexusFolder(ctx, "Google Nexus Generations")))
    : undefined;

  let index = 0;
  for (const uri of uris) {
    index += 1;
    const bytes = await downloadVeoFile(uri);
    clips.push(
      saveToDrive
        ? {
            ...(await saveBinaryToDrive(ctx, {
              name: `nexus-video-${Date.now()}-${index}.mp4`,
              mimeType: "video/mp4",
              data: bytes,
              folderId: targetFolder,
            })),
          }
        : { mimeType: "video/mp4", bytes: bytes.length, sourceUri: uri },
    );
  }
  for (const clip of inline) {
    index += 1;
    const bytes = base64ToBytes(clip.base64);
    clips.push(
      saveToDrive
        ? await saveBinaryToDrive(ctx, {
            name: `nexus-video-${Date.now()}-${index}.mp4`,
            mimeType: clip.mimeType,
            data: bytes,
            folderId: targetFolder,
          })
        : { mimeType: clip.mimeType, bytes: bytes.length },
    );
  }

  return publicJob(
    await updateJob(job.id, {
      status: "completed",
      statusDetail: `${clips.length} clip(s) ready`,
      result: { clips },
    }),
  );
}

export const veoAdapter = defineAdapter({
  service: "video",
  label: "Video generation (Veo)",
  description:
    "Async video generation on Veo with Drive-backed results, exposed as one job API Claude can poll.",
  status: "requires-configuration",
  statusNote:
    "Implemented against Veo on the Gemini API (predictLongRunning + operations polling). Needs a Google AI Studio API key (GOOGLE_AI_API_KEY); finished clips are saved to the connected account's Drive.",
  docsUrl: "https://ai.google.dev/gemini-api/docs/video",
  requiresGoogleAuth: false,
  healthCheck: async () => {
    if (!geminiApiKey()) return { ok: false, detail: "GOOGLE_AI_API_KEY is not configured" };
    const response = await geminiFetch(`models/${DEFAULT_VEO_MODEL}`);
    return response.ok
      ? { ok: true, detail: `${DEFAULT_VEO_MODEL} reachable` }
      : { ok: false, detail: `Veo model check returned HTTP ${response.status}` };
  },
  capabilities: [
    defineCapability({
      id: "video.generate",
      title: "Generate a video",
      description:
        "Start a Veo video generation from a text prompt (and optional first-frame image). Returns a jobId — poll it with video.status.",
      implementation: "gemini-api",
      scopes: [],
      mutating: true,
      input: z.object({
        prompt: z.string().min(1),
        model: z.string().default(DEFAULT_VEO_MODEL),
        aspectRatio: z.enum(["16:9", "9:16"]).default("16:9"),
        negativePrompt: z.string().optional(),
        imageBase64: z.string().optional(),
        imageMimeType: z.string().default("image/png"),
        saveToDrive: z.boolean().default(true),
        driveFolderId: z.string().optional(),
      }),
      run: async (ctx, input) => {
        const instance: Record<string, unknown> = { prompt: input.prompt };
        if (input.imageBase64) {
          instance["image"] = {
            bytesBase64Encoded: input.imageBase64,
            mimeType: input.imageMimeType,
          };
        }
        const operation = await geminiJson<GeminiOperation>(
          `models/${input.model}:predictLongRunning`,
          {
            body: {
              instances: [instance],
              parameters: {
                aspectRatio: input.aspectRatio,
                ...(input.negativePrompt ? { negativePrompt: input.negativePrompt } : {}),
              },
            },
          },
        );
        const job = await createJob({
          userId: ctx.userId,
          kind: "video",
          provider: "gemini-api",
          model: input.model,
          prompt: input.prompt,
          parameters: {
            aspectRatio: input.aspectRatio,
            saveToDrive: input.saveToDrive,
            driveFolderId: input.driveFolderId ?? null,
          },
          status: "running",
          statusDetail: "Veo generation started",
          operationName: operation.name,
        });
        return {
          ...publicJob(job),
          hint: "Videos take roughly 1-3 minutes. Call video.status with this jobId.",
        };
      },
    }),
    defineCapability({
      id: "video.status",
      title: "Check a video job",
      description:
        "Poll a video job. When Veo has finished, the clip is uploaded to Drive and returned as an asset link.",
      implementation: "gemini-api",
      scopes: [],
      input: z.object({ jobId: z.string().min(1) }),
      run: (ctx, input) => resolveJob(ctx, input.jobId),
    }),
    defineCapability({
      id: "video.list_jobs",
      title: "List video jobs",
      description: "List recent video generation jobs for the connected account.",
      implementation: "gemini-api",
      scopes: [],
      input: z.object({ limit: z.number().int().min(1).max(50).default(10) }),
      run: async (ctx, input) => {
        const { listJobs } = await import("@/lib/nexus/jobs.server");
        const jobs = await listJobs(ctx.userId, { kind: "video", limit: input.limit });
        return { jobs: jobs.map(publicJob) };
      },
    }),
  ],
});

export default veoAdapter;