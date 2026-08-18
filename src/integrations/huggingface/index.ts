import { z } from "zod";

import { huggingfaceInferBinary } from "@/lib/nexus/huggingface.server";
import { defineAdapter, defineCapability } from "@/lib/nexus/types";

/**
 * Hugging Face Inference API — the genuinely free-tier option in this
 * connector: no billing account required for hobby-scale requests, unlike
 * Vertex AI (Lyria) or Replicate (pay-as-you-go). Trade-off is shared,
 * rate-limited infrastructure with cold starts, so it suits short clips and
 * occasional use rather than production volume.
 * https://huggingface.co/docs/api-inference
 */
export const huggingfaceAdapter = defineAdapter({
  service: "huggingface",
  label: "Hugging Face",
  description: "Free-tier music (MusicGen) and image (Stable Diffusion) generation.",
  status: "requires-configuration",
  statusNote:
    "Needs HUGGINGFACE_API_TOKEN as an environment secret (create a free one at huggingface.co/settings/tokens). Unlike Vertex/Lyria, this genuinely needs no billing account for hobby-scale use — but expect cold starts (20-60s) and rate limits since it's shared infrastructure.",
  docsUrl: "https://huggingface.co/docs/api-inference",
  requiresGoogleAuth: false,
  capabilities: [
    defineCapability({
      id: "huggingface.generate_music",
      title: "Generate music (free tier)",
      description:
        "Text-to-music using Meta's MusicGen-small, via Hugging Face's free Inference API. Short clips (a few seconds to ~30s).",
      implementation: "google-rest-api",
      scopes: [],
      input: z.object({ prompt: z.string().min(1) }),
      run: async (_ctx, input) => {
        const result = await huggingfaceInferBinary({
          model: "facebook/musicgen-small",
          input: input.prompt,
          timeoutMs: 90_000,
        });
        return { audio: result };
      },
    }),
    defineCapability({
      id: "huggingface.generate_image",
      title: "Generate an image (free tier)",
      description:
        "Text-to-image using Stable Diffusion XL, via Hugging Face's free Inference API.",
      implementation: "google-rest-api",
      scopes: [],
      input: z.object({ prompt: z.string().min(1) }),
      run: async (_ctx, input) => {
        const result = await huggingfaceInferBinary({
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          input: input.prompt,
          timeoutMs: 90_000,
        });
        return { image: result };
      },
    }),
  ],
});

export default huggingfaceAdapter;
