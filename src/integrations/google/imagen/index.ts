import { z } from "zod";

import {
  base64ToBytes,
  ensureNexusFolder,
  readDriveBinary,
  saveBinaryToDrive,
} from "@/lib/nexus/driveAssets.server";
import { NexusError } from "@/lib/nexus/errors";
import {
  collectInlineImages,
  geminiApiKey,
  geminiGenerateContent,
  geminiJson,
} from "@/lib/nexus/gemini.server";
import { createJob, publicJob } from "@/lib/nexus/jobs.server";
import { defineAdapter, defineCapability, type AdapterContext } from "@/lib/nexus/types";

/**
 * Normalized Nexus image API. Underneath it uses the two real programmatic
 * Google image surfaces:
 *   - Imagen on Vertex AI (`publishers/google/models/imagen-*:predict`)
 *     https://cloud.google.com/vertex-ai/generative-ai/docs/image/generate-images
 *     NOTE: Imagen is NOT served by the public Gemini API key (ai.google.dev) —
 *     calling it there returns a "no longer available to new users" error
 *     regardless of the model version pinned. It only works via Vertex AI's
 *     predict endpoint, authenticated with the connected account's
 *     cloud-platform OAuth grant (same pattern as the Lyria music adapter).
 *   - Gemini native image generation/editing (`gemini-*-image:generateContent`)
 *     https://ai.google.dev/gemini-api/docs/image-generation
 *     This one *is* served by the Gemini API key and needs no Cloud project.
 * Claude only ever sees image.generate / image.edit / image.variations.
 */
const DEFAULT_IMAGEN_MODEL = "imagen-4.0-generate-001";
// gemini-2.5-flash-image is confirmed reachable on the public Gemini API;
// this is also the default engine now, since it needs only an API key and
// no Vertex/Cloud-project configuration to work.
const DEFAULT_GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";

interface ImagenPredictResponse {
  predictions?: { bytesBase64Encoded?: string; mimeType?: string }[];
}

function cloudProject(): string {
  const project = process.env["GOOGLE_CLOUD_PROJECT"]?.trim();
  if (!project) {
    throw new NexusError(
      "vertex_not_configured",
      "The imagen engine runs on Vertex AI, which needs a Google Cloud project. Set GOOGLE_CLOUD_PROJECT and re-connect Google so the cloud-platform permission is granted, or use engine: 'gemini' instead, which only needs GOOGLE_AI_API_KEY.",
      503,
    );
  }
  return project;
}

function vertexLocation(): string {
  return process.env["GOOGLE_CLOUD_LOCATION"]?.trim() || "us-central1";
}

async function imagenPredict(
  ctx: AdapterContext,
  params: {
    model: string;
    prompt: string;
    count: number;
    aspectRatio: string;
  },
) {
  const project = cloudProject();
  const location = vertexLocation();
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${params.model}:predict`;
  const response = await ctx.api<ImagenPredictResponse>(url, {
    body: {
      instances: [{ prompt: params.prompt }],
      parameters: {
        sampleCount: params.count,
        aspectRatio: params.aspectRatio,
        personGeneration: "allow_adult",
      },
    },
  });
  const images = (response.predictions ?? [])
    .filter((prediction) => prediction.bytesBase64Encoded)
    .map((prediction) => ({
      mimeType: prediction.mimeType ?? "image/png",
      data: prediction.bytesBase64Encoded as string,
    }));
  if (images.length === 0) {
    throw new NexusError("image_no_output", "Imagen returned no image data.", 502);
  }
  return images;
}

async function geminiImage(params: {
  model: string;
  prompt: string;
  inputImages?: { mimeType: string; base64: string }[];
}) {
  const parts: Record<string, unknown>[] = [{ text: params.prompt }];
  for (const image of params.inputImages ?? []) {
    parts.push({ inlineData: { mimeType: image.mimeType, data: image.base64 } });
  }
  const response = await geminiGenerateContent(params.model, {
    contents: [{ role: "user", parts }],
  });
  const images = collectInlineImages(response);
  if (images.length === 0) {
    throw new NexusError(
      "image_no_output",
      "The Gemini image model returned no image (it may have refused the prompt).",
      502,
    );
  }
  return images;
}

async function persist(
  ctx: AdapterContext,
  params: {
    images: { mimeType: string; data: string }[];
    prompt: string;
    model: string;
    folderId?: string | undefined;
    returnBase64: boolean;
    saveToDrive: boolean;
    parameters: Record<string, unknown>;
  },
) {
  let assets: unknown[] = [];
  if (params.saveToDrive) {
    const folderId = params.folderId ?? (await ensureNexusFolder(ctx, "Google Nexus Generations"));
    assets = await Promise.all(
      params.images.map(async (image, index) =>
        saveBinaryToDrive(ctx, {
          name: `nexus-image-${Date.now()}-${index + 1}.${image.mimeType.includes("jpeg") ? "jpg" : "png"}`,
          mimeType: image.mimeType,
          data: base64ToBytes(image.data),
          folderId,
        }),
      ),
    );
  }

  const result = {
    images: params.images.map((image, index) => ({
      mimeType: image.mimeType,
      bytes: Math.round((image.data.length * 3) / 4),
      ...(params.returnBase64 ? { base64: image.data } : {}),
      asset: (assets[index] as Record<string, unknown> | undefined) ?? null,
    })),
  };

  const job = await createJob({
    userId: ctx.userId,
    kind: "image",
    provider: "gemini-api",
    model: params.model,
    prompt: params.prompt,
    parameters: params.parameters,
    status: "completed",
    statusDetail: `${params.images.length} image(s) generated`,
    result: { images: result.images.map(({ base64: _base64, ...rest }) => rest) },
  });

  return { ...publicJob(job), ...result };
}

export const imagenAdapter = defineAdapter({
  service: "image",
  label: "Image generation (Imagen + Gemini)",
  description:
    "One image API over Imagen and Gemini native image generation, with results saved to Drive.",
  status: "requires-configuration",
  statusNote:
    "Implemented against the Gemini API (Imagen predict + Gemini image generateContent). It needs a Google AI Studio API key (GOOGLE_AI_API_KEY) because Google authenticates these models with an API key, not with Workspace OAuth. Saving results to Drive additionally uses the connected Google account.",
  docsUrl: "https://ai.google.dev/gemini-api/docs/imagen",
  requiresGoogleAuth: false,
  healthCheck: async () => {
    if (!geminiApiKey()) return { ok: false, detail: "GOOGLE_AI_API_KEY is not configured" };
    await geminiJson("models");
    return { ok: true, detail: "Gemini/Imagen models reachable" };
  },
  capabilities: [
    defineCapability({
      id: "image.generate",
      title: "Generate images",
      description:
        "Generate one or more images from a prompt. Results are stored in Drive and returned as asset links; set returnBase64 for inline bytes.",
      implementation: "gemini-api",
      scopes: [],
      mutating: true,
      input: z.object({
        prompt: z.string().min(1),
        count: z.number().int().min(1).max(4).default(1),
        aspectRatio: z.enum(["1:1", "3:4", "4:3", "9:16", "16:9"]).default("1:1"),
        // "gemini" is the default because it only needs GOOGLE_AI_API_KEY.
        // "imagen" needs Vertex AI + GOOGLE_CLOUD_PROJECT configured (see
        // cloudProject() above) and should be requested explicitly once that
        // is set up.
        engine: z.enum(["imagen", "gemini"]).default("gemini"),
        model: z.string().optional(),
        saveToDrive: z.boolean().default(true),
        driveFolderId: z.string().optional(),
        returnBase64: z.boolean().default(false),
      }),
      run: async (ctx, input) => {
        const model =
          input.model ??
          (input.engine === "imagen" ? DEFAULT_IMAGEN_MODEL : DEFAULT_GEMINI_IMAGE_MODEL);
        const images =
          input.engine === "imagen"
            ? await imagenPredict(ctx, {
                model,
                prompt: input.prompt,
                count: input.count,
                aspectRatio: input.aspectRatio,
              })
            : await geminiImage({ model, prompt: input.prompt });
        return persist(ctx, {
          images,
          prompt: input.prompt,
          model,
          folderId: input.driveFolderId,
          returnBase64: input.returnBase64,
          saveToDrive: input.saveToDrive,
          parameters: { engine: input.engine, aspectRatio: input.aspectRatio, count: input.count },
        });
      },
    }),
    defineCapability({
      id: "image.edit",
      title: "Edit an image",
      description:
        "Edit an existing image with an instruction. Provide the source as a Drive file id or base64.",
      implementation: "gemini-api",
      scopes: [],
      mutating: true,
      input: z.object({
        prompt: z.string().min(1),
        driveFileId: z.string().optional(),
        imageBase64: z.string().optional(),
        imageMimeType: z.string().default("image/png"),
        model: z.string().default(DEFAULT_GEMINI_IMAGE_MODEL),
        saveToDrive: z.boolean().default(true),
        driveFolderId: z.string().optional(),
        returnBase64: z.boolean().default(false),
      }),
      run: async (ctx, input) => {
        let source: { mimeType: string; base64: string };
        if (input.driveFileId) {
          source = await readDriveBinary(ctx, input.driveFileId);
        } else if (input.imageBase64) {
          source = { mimeType: input.imageMimeType, base64: input.imageBase64 };
        } else {
          throw new NexusError(
            "image_source_required",
            "Provide either driveFileId or imageBase64 for image.edit.",
          );
        }
        const images = await geminiImage({
          model: input.model,
          prompt: input.prompt,
          inputImages: [source],
        });
        return persist(ctx, {
          images,
          prompt: input.prompt,
          model: input.model,
          folderId: input.driveFolderId,
          returnBase64: input.returnBase64,
          saveToDrive: input.saveToDrive,
          parameters: { mode: "edit", driveFileId: input.driveFileId ?? null },
        });
      },
    }),
    defineCapability({
      id: "image.variations",
      title: "Create image variations",
      description: "Create variations of an existing image, optionally steered by a prompt.",
      implementation: "gemini-api",
      scopes: [],
      mutating: true,
      input: z.object({
        driveFileId: z.string().min(1),
        prompt: z.string().default("Create a variation of this image, keeping subject and style."),
        count: z.number().int().min(1).max(4).default(2),
        model: z.string().default(DEFAULT_GEMINI_IMAGE_MODEL),
        saveToDrive: z.boolean().default(true),
        driveFolderId: z.string().optional(),
      }),
      run: async (ctx, input) => {
        const source = await readDriveBinary(ctx, input.driveFileId);
        const batches = await Promise.all(
          Array.from({ length: input.count }, () =>
            geminiImage({ model: input.model, prompt: input.prompt, inputImages: [source] }),
          ),
        );
        return persist(ctx, {
          images: batches.flat(),
          prompt: input.prompt,
          model: input.model,
          folderId: input.driveFolderId,
          returnBase64: false,
          saveToDrive: input.saveToDrive,
          parameters: { mode: "variations", driveFileId: input.driveFileId, count: input.count },
        });
      },
    }),
  ],
});

export default imagenAdapter;