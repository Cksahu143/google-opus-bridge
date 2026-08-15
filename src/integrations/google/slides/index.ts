import { z } from "zod";

import { SCOPES } from "@/lib/nexus/scopes";
import { defineAdapter, defineCapability } from "@/lib/nexus/types";

const BASE = "https://slides.googleapis.com/v1/presentations";

interface Presentation {
  presentationId: string;
  title: string;
  slides?: {
    objectId: string;
    pageElements?: { shape?: { text?: { textElements?: { textRun?: { content?: string } }[] } } }[];
  }[];
}

/** Slides API v1 — https://developers.google.com/workspace/slides/api/reference/rest */
export const slidesAdapter = defineAdapter({
  service: "slides",
  label: "Google Slides",
  description: "Create presentations, add slides and read slide text with the official Slides API.",
  status: "supported",
  statusNote: "Official Slides API v1 (create, read text, add titled slides, replace text).",
  docsUrl: "https://developers.google.com/workspace/slides/api/reference/rest",
  capabilities: [
    defineCapability({
      id: "slides.create",
      title: "Create a presentation",
      description: "Create an empty Google Slides presentation.",
      implementation: "google-rest-api",
      scopes: [SCOPES.presentations],
      mutating: true,
      input: z.object({ title: z.string().min(1) }),
      run: async (ctx, input) => {
        const created = await ctx.api<Presentation>(BASE, { body: { title: input.title } });
        return {
          presentationId: created.presentationId,
          url: `https://docs.google.com/presentation/d/${created.presentationId}/edit`,
        };
      },
    }),
    defineCapability({
      id: "slides.read",
      title: "Read a presentation",
      description: "Read slide ids and their text content.",
      implementation: "google-rest-api",
      scopes: [SCOPES.presentations],
      input: z.object({ presentationId: z.string().min(1) }),
      run: async (ctx, input) => {
        const presentation = await ctx.api<Presentation>(`${BASE}/${input.presentationId}`);
        return {
          title: presentation.title,
          slides: (presentation.slides ?? []).map((slide, index) => ({
            index,
            objectId: slide.objectId,
            text: (slide.pageElements ?? [])
              .flatMap((element) => element.shape?.text?.textElements ?? [])
              .map((element) => element.textRun?.content ?? "")
              .join("")
              .trim(),
          })),
        };
      },
    }),
    defineCapability({
      id: "slides.add_slide",
      title: "Add a slide",
      description:
        "Append a slide using the TITLE_AND_BODY layout and fill in its title and body text.",
      implementation: "google-rest-api",
      scopes: [SCOPES.presentations],
      mutating: true,
      input: z.object({
        presentationId: z.string().min(1),
        title: z.string().default(""),
        body: z.string().default(""),
      }),
      run: async (ctx, input) => {
        const slideId = `nexus_${Date.now().toString(36)}`;
        const titleId = `${slideId}_title`;
        const bodyId = `${slideId}_body`;
        await ctx.api(`${BASE}/${input.presentationId}:batchUpdate`, {
          body: {
            requests: [
              {
                createSlide: {
                  objectId: slideId,
                  slideLayoutReference: { predefinedLayout: "TITLE_AND_BODY" },
                  placeholderIdMappings: [
                    { layoutPlaceholder: { type: "TITLE" }, objectId: titleId },
                    { layoutPlaceholder: { type: "BODY" }, objectId: bodyId },
                  ],
                },
              },
              ...(input.title
                ? [{ insertText: { objectId: titleId, text: input.title } }]
                : []),
              ...(input.body ? [{ insertText: { objectId: bodyId, text: input.body } }] : []),
            ],
          },
        });
        return { slideObjectId: slideId };
      },
    }),
    defineCapability({
      id: "slides.replace_text",
      title: "Find and replace",
      description: "Replace every occurrence of a string across the presentation.",
      implementation: "google-rest-api",
      scopes: [SCOPES.presentations],
      mutating: true,
      input: z.object({
        presentationId: z.string().min(1),
        find: z.string().min(1),
        replace: z.string(),
      }),
      run: (ctx, input) =>
        ctx.api(`${BASE}/${input.presentationId}:batchUpdate`, {
          body: {
            requests: [
              {
                replaceAllText: {
                  containsText: { text: input.find, matchCase: true },
                  replaceText: input.replace,
                },
              },
            ],
          },
        }),
    }),
  ],
});

export default slidesAdapter;