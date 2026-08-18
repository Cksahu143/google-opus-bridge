import { z } from "zod";

import { replicateRunModel } from "@/lib/nexus/replicate.server";
import { defineAdapter, defineCapability } from "@/lib/nexus/types";

/**
 * Replicate — a real, non-Google generation backend covering image, music,
 * and video behind one token. Pay-as-you-go with trial credit for new
 * accounts (no subscription, no minimum spend), which in practice is often
 * usable well before Vertex AI's Lyria allowlist is ever approved.
 * https://replicate.com/docs
 *
 * This is still a metered API, not free/unlimited — every run costs a
 * small amount once trial credit runs out. It is, however, a real working
 * alternative today, with no manual Google approval process blocking it.
 */
export const replicateAdapter = defineAdapter({
  service: "replicate",
  label: "Replicate",
  description:
    "Non-Google image, music, and video generation (Flux/SDXL, MusicGen/ACE-Step, Stable Video Diffusion).",
  status: "requires-configuration",
  statusNote:
    "Needs REPLICATE_API_TOKEN as an environment secret (create one at replicate.com/account/api-tokens). Pay-as-you-go with free trial credit for new accounts — not truly unlimited, but not gated behind manual approval like Lyria either.",
  docsUrl: "https://replicate.com/docs/reference/http",
  requiresGoogleAuth: false,
  capabilities: [
    defineCapability({
      id: "replicate.generate_image",
      title: "Generate an image",
      description: "Text-to-image using Flux (default) or Stable Diffusion XL.",
      implementation: "google-rest-api",
      scopes: [],
      input: z.object({
        prompt: z.string().min(1),
        model: z.enum(["flux-schnell", "sdxl"]).default("flux-schnell"),
        aspectRatio: z.string().default("1:1"),
      }),
      run: async (_ctx, input) => {
        const [owner, name] =
          input.model === "sdxl" ? ["stability-ai", "sdxl"] : ["black-forest-labs", "flux-schnell"];
        const output = await replicateRunModel({
          owner,
          name,
          input:
            input.model === "sdxl"
              ? { prompt: input.prompt }
              : { prompt: input.prompt, aspect_ratio: input.aspectRatio },
        });
        return { images: output };
      },
    }),
    defineCapability({
      id: "replicate.generate_music",
      title: "Generate music",
      description: "Text-to-music using Meta's MusicGen. 8–30 second instrumental clips.",
      implementation: "google-rest-api",
      scopes: [],
      input: z.object({
        prompt: z.string().min(1),
        durationSeconds: z.number().int().min(4).max(30).default(12),
      }),
      run: async (_ctx, input) => {
        const output = await replicateRunModel({
          owner: "meta",
          name: "musicgen",
          input: { prompt: input.prompt, duration: input.durationSeconds, model_version: "large" },
          timeoutMs: 180_000,
        });
        return { audio: output };
      },
    }),
    defineCapability({
      id: "replicate.generate_song",
      title: "Generate a full song with vocals",
      description:
        "ACE-Step: generates a complete song with vocals from lyrics and a style description, in roughly 20 seconds.",
      implementation: "google-rest-api",
      scopes: [],
      input: z.object({
        lyrics: z
          .string()
          .min(1)
          .describe("Song lyrics, optionally with structure tags like [verse]/[chorus]."),
        styleDescription: z
          .string()
          .min(1)
          .describe("e.g. 'lofi hip hop, female vocals, 90 bpm, dreamy'"),
      }),
      run: async (_ctx, input) => {
        const output = await replicateRunModel({
          owner: "ace-step",
          name: "ace-step",
          input: { lyrics: input.lyrics, tags: input.styleDescription },
          timeoutMs: 180_000,
        });
        return { audio: output };
      },
    }),
    defineCapability({
      id: "replicate.generate_video",
      title: "Generate a video",
      description:
        "Image-to-video using Stable Video Diffusion — animates a still image into a short clip.",
      implementation: "google-rest-api",
      scopes: [],
      input: z.object({
        imageUrl: z
          .string()
          .url()
          .describe("Publicly reachable URL of the still image to animate."),
      }),
      run: async (_ctx, input) => {
        const output = await replicateRunModel({
          owner: "stability-ai",
          name: "stable-video-diffusion",
          input: { input_image: input.imageUrl },
          timeoutMs: 240_000,
        });
        return { video: output };
      },
    }),
    defineCapability({
      id: "replicate.run_model",
      title: "Run any Replicate model",
      description:
        "Escape hatch: run any public Replicate model by owner/name with raw input, for models not covered by the specific capabilities above.",
      implementation: "google-rest-api",
      scopes: [],
      input: z.object({
        owner: z.string().min(1),
        name: z.string().min(1),
        input: z.record(z.string(), z.unknown()),
      }),
      run: (_ctx, input) =>
        replicateRunModel({ owner: input.owner, name: input.name, input: input.input }),
    }),
  ],
});

export default replicateAdapter;
