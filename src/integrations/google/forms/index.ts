import { z } from "zod";

import { SCOPES } from "@/lib/nexus/scopes";
import { defineAdapter, defineCapability } from "@/lib/nexus/types";

const BASE = "https://forms.googleapis.com/v1/forms";

/** Forms API v1 — https://developers.google.com/workspace/forms/api/reference/rest */
export const formsAdapter = defineAdapter({
  service: "forms",
  label: "Google Forms",
  description: "Create forms, add questions and read responses with the official Forms API.",
  status: "supported",
  statusNote: "Official Forms API v1 (create, read, add text questions, list responses).",
  docsUrl: "https://developers.google.com/workspace/forms/api/reference/rest",
  capabilities: [
    defineCapability({
      id: "forms.create",
      title: "Create a form",
      description: "Create a Google Form with a title.",
      implementation: "google-rest-api",
      scopes: [SCOPES.forms, SCOPES.drive],
      mutating: true,
      input: z.object({ title: z.string().min(1), documentTitle: z.string().optional() }),
      run: async (ctx, input) => {
        const created = await ctx.api<{ formId: string; responderUri?: string }>(BASE, {
          body: {
            info: {
              title: input.title,
              ...(input.documentTitle ? { documentTitle: input.documentTitle } : {}),
            },
          },
        });
        return {
          formId: created.formId,
          editUrl: `https://docs.google.com/forms/d/${created.formId}/edit`,
          responderUri: created.responderUri ?? null,
        };
      },
    }),
    defineCapability({
      id: "forms.get",
      title: "Get a form",
      description: "Read a form's structure and questions.",
      implementation: "google-rest-api",
      scopes: [SCOPES.forms],
      input: z.object({ formId: z.string().min(1) }),
      run: (ctx, input) => ctx.api(`${BASE}/${input.formId}`),
    }),
    defineCapability({
      id: "forms.add_question",
      title: "Add a text question",
      description: "Append a short-answer or paragraph question to a form.",
      implementation: "google-rest-api",
      scopes: [SCOPES.forms],
      mutating: true,
      input: z.object({
        formId: z.string().min(1),
        title: z.string().min(1),
        paragraph: z.boolean().default(false),
        required: z.boolean().default(false),
        index: z.number().int().min(0).default(0),
      }),
      run: (ctx, input) =>
        ctx.api(`${BASE}/${input.formId}:batchUpdate`, {
          body: {
            requests: [
              {
                createItem: {
                  item: {
                    title: input.title,
                    questionItem: {
                      question: {
                        required: input.required,
                        textQuestion: { paragraph: input.paragraph },
                      },
                    },
                  },
                  location: { index: input.index },
                },
              },
            ],
          },
        }),
    }),
    defineCapability({
      id: "forms.list_responses",
      title: "List responses",
      description: "List submitted responses for a form.",
      implementation: "google-rest-api",
      scopes: [SCOPES.formsResponses],
      input: z.object({ formId: z.string().min(1) }),
      run: (ctx, input) => ctx.api(`${BASE}/${input.formId}/responses`),
    }),
  ],
});

export default formsAdapter;