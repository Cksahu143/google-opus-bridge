import { z } from "zod";

import { SCOPES } from "@/lib/nexus/scopes";
import { defineAdapter, defineCapability } from "@/lib/nexus/types";

const BASE = "https://docs.googleapis.com/v1/documents";

interface DocElement {
  paragraph?: { elements?: { textRun?: { content?: string } }[] };
  table?: { tableRows?: { tableCells?: { content?: DocElement[] }[] }[] };
}

function documentText(body: { content?: DocElement[] } | undefined): string {
  const out: string[] = [];
  const walk = (elements: DocElement[] | undefined) => {
    for (const element of elements ?? []) {
      for (const run of element.paragraph?.elements ?? []) {
        if (run.textRun?.content) out.push(run.textRun.content);
      }
      for (const row of element.table?.tableRows ?? []) {
        for (const cell of row.tableCells ?? []) walk(cell.content);
      }
    }
  };
  walk(body?.content);
  return out.join("");
}

/** Docs API v1 — https://developers.google.com/workspace/docs/api/reference/rest */
export const docsAdapter = defineAdapter({
  service: "docs",
  label: "Google Docs",
  description: "Create documents and read or edit their content with the official Docs API.",
  status: "supported",
  statusNote: "Official Docs API v1 (create, read text, insert text, find & replace).",
  docsUrl: "https://developers.google.com/workspace/docs/api/reference/rest",
  capabilities: [
    defineCapability({
      id: "docs.create",
      title: "Create a document",
      description:
        "Create a Google Doc with an optional initial body of text. Returns the document id and its Drive link.",
      implementation: "google-rest-api",
      scopes: [SCOPES.documents, SCOPES.drive],
      mutating: true,
      input: z.object({
        title: z.string().min(1),
        content: z.string().default(""),
        parentFolderId: z.string().optional(),
      }),
      run: async (ctx, input) => {
        const doc = await ctx.api<{ documentId: string }>(BASE, { body: { title: input.title } });
        if (input.content) {
          await ctx.api(`${BASE}/${doc.documentId}:batchUpdate`, {
            body: {
              requests: [
                { insertText: { location: { index: 1 }, text: input.content } },
              ],
            },
          });
        }
        if (input.parentFolderId) {
          const params = new URLSearchParams({
            addParents: input.parentFolderId,
            supportsAllDrives: "true",
          });
          await ctx.api(
            `https://www.googleapis.com/drive/v3/files/${doc.documentId}?${params.toString()}`,
            { method: "PATCH", body: {} },
          );
        }
        return {
          documentId: doc.documentId,
          url: `https://docs.google.com/document/d/${doc.documentId}/edit`,
        };
      },
    }),
    defineCapability({
      id: "docs.read",
      title: "Read a document",
      description: "Read a Google Doc's title and plain-text content.",
      implementation: "google-rest-api",
      scopes: [SCOPES.documents],
      input: z.object({
        documentId: z.string().min(1),
        maxCharacters: z.number().int().min(500).max(200_000).default(50_000),
      }),
      run: async (ctx, input) => {
        const doc = await ctx.api<{ title: string; body?: { content?: DocElement[] } }>(
          `${BASE}/${input.documentId}`,
        );
        const text = documentText(doc.body);
        return {
          documentId: input.documentId,
          title: doc.title,
          truncated: text.length > input.maxCharacters,
          text: text.slice(0, input.maxCharacters),
        };
      },
    }),
    defineCapability({
      id: "docs.append_text",
      title: "Append text",
      description: "Append text to the end of a Google Doc.",
      implementation: "google-rest-api",
      scopes: [SCOPES.documents],
      mutating: true,
      input: z.object({ documentId: z.string().min(1), text: z.string().min(1) }),
      run: (ctx, input) =>
        ctx.api(`${BASE}/${input.documentId}:batchUpdate`, {
          body: { requests: [{ insertText: { endOfSegmentLocation: {}, text: input.text } }] },
        }),
    }),
    defineCapability({
      id: "docs.replace_text",
      title: "Find and replace",
      description: "Replace every occurrence of a string in a Google Doc.",
      implementation: "google-rest-api",
      scopes: [SCOPES.documents],
      mutating: true,
      input: z.object({
        documentId: z.string().min(1),
        find: z.string().min(1),
        replace: z.string(),
        matchCase: z.boolean().default(true),
      }),
      run: (ctx, input) =>
        ctx.api(`${BASE}/${input.documentId}:batchUpdate`, {
          body: {
            requests: [
              {
                replaceAllText: {
                  containsText: { text: input.find, matchCase: input.matchCase },
                  replaceText: input.replace,
                },
              },
            ],
          },
        }),
    }),
  ],
});

export default docsAdapter;