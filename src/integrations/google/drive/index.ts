import { z } from "zod";

import { SCOPES } from "@/lib/nexus/scopes";
import { defineAdapter, defineCapability } from "@/lib/nexus/types";

const FILES = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

const FILE_FIELDS = "id,name,mimeType,modifiedTime,size,owners(emailAddress),webViewLink,parents";

/** Drive API v3 — https://developers.google.com/workspace/drive/api/reference/rest/v3 */
export const driveAdapter = defineAdapter({
  service: "drive",
  label: "Google Drive",
  description: "Search, read, create and organise Drive files with the official Drive API.",
  status: "supported",
  statusNote: "Official Drive API v3, including Workspace-document text export.",
  docsUrl: "https://developers.google.com/workspace/drive/api/reference/rest/v3",
  healthCheck: async (ctx) => {
    const about = await ctx.api<{ user: { emailAddress: string } }>(
      "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)",
    );
    return { ok: true, detail: `Drive reachable as ${about.user.emailAddress}` };
  },
  capabilities: [
    defineCapability({
      id: "drive.search",
      title: "Search Drive",
      description:
        "Search Drive files by free text or a Drive query string, newest first. Returns file ids usable by the docs/sheets/slides capabilities.",
      implementation: "google-rest-api",
      scopes: [SCOPES.drive],
      input: z.object({
        query: z.string().optional().describe("Free-text search terms"),
        driveQuery: z
          .string()
          .optional()
          .describe("Raw Drive query, e.g. \"mimeType='application/vnd.google-apps.document'\""),
        maxResults: z.number().int().min(1).max(100).default(20),
      }),
      run: async (ctx, input) => {
        const clauses: string[] = ["trashed = false"];
        if (input.query) clauses.push(`fullText contains '${input.query.replace(/'/g, "\\'")}'`);
        if (input.driveQuery) clauses.push(`(${input.driveQuery})`);
        const params = new URLSearchParams({
          q: clauses.join(" and "),
          pageSize: String(input.maxResults),
          orderBy: "modifiedTime desc",
          fields: `files(${FILE_FIELDS})`,
          supportsAllDrives: "true",
          includeItemsFromAllDrives: "true",
        });
        const res = await ctx.api<{ files?: unknown[] }>(`${FILES}?${params.toString()}`);
        return { files: res.files ?? [] };
      },
    }),
    defineCapability({
      id: "drive.get",
      title: "Get file metadata",
      description: "Fetch metadata for a single Drive file id.",
      implementation: "google-rest-api",
      scopes: [SCOPES.drive],
      input: z.object({ fileId: z.string().min(1) }),
      run: (ctx, input) =>
        ctx.api(`${FILES}/${input.fileId}?fields=${FILE_FIELDS}&supportsAllDrives=true`),
    }),
    defineCapability({
      id: "drive.read_text",
      title: "Read file as text",
      description:
        "Read a Drive file as plain text. Google Docs/Sheets/Slides are exported; plain-text and markdown files are downloaded directly.",
      implementation: "google-rest-api",
      scopes: [SCOPES.drive],
      input: z.object({
        fileId: z.string().min(1),
        maxCharacters: z.number().int().min(500).max(200_000).default(50_000),
      }),
      run: async (ctx, input) => {
        const meta = await ctx.api<{ name: string; mimeType: string }>(
          `${FILES}/${input.fileId}?fields=name,mimeType&supportsAllDrives=true`,
        );
        const exportMap: Record<string, string> = {
          "application/vnd.google-apps.document": "text/plain",
          "application/vnd.google-apps.spreadsheet": "text/csv",
          "application/vnd.google-apps.presentation": "text/plain",
        };
        const exportMime = exportMap[meta.mimeType];
        const url = exportMime
          ? `${FILES}/${input.fileId}/export?mimeType=${encodeURIComponent(exportMime)}`
          : `${FILES}/${input.fileId}?alt=media&supportsAllDrives=true`;
        const response = await ctx.raw(url);
        if (!response.ok) {
          throw new Error(
            `Drive could not return text for ${meta.name} (${meta.mimeType}): ${response.status}`,
          );
        }
        const text = await response.text();
        return {
          name: meta.name,
          mimeType: meta.mimeType,
          truncated: text.length > input.maxCharacters,
          text: text.slice(0, input.maxCharacters),
        };
      },
    }),
    defineCapability({
      id: "drive.create_text_file",
      title: "Create a text file",
      description:
        "Create a new Drive file from text content (multipart upload). Use mimeType text/plain, text/markdown or text/csv.",
      implementation: "google-rest-api",
      scopes: [SCOPES.drive],
      mutating: true,
      input: z.object({
        name: z.string().min(1),
        content: z.string().default(""),
        mimeType: z.string().default("text/plain"),
        parentFolderId: z.string().optional(),
      }),
      run: async (ctx, input) => {
        const boundary = `nexus-${Math.random().toString(36).slice(2)}`;
        const metadata = {
          name: input.name,
          mimeType: input.mimeType,
          ...(input.parentFolderId ? { parents: [input.parentFolderId] } : {}),
        };
        const body = [
          `--${boundary}`,
          "Content-Type: application/json; charset=UTF-8",
          "",
          JSON.stringify(metadata),
          `--${boundary}`,
          `Content-Type: ${input.mimeType}; charset=UTF-8`,
          "",
          input.content,
          `--${boundary}--`,
          "",
        ].join("\r\n");
        const response = await ctx.raw(
          `${UPLOAD}?uploadType=multipart&supportsAllDrives=true&fields=${FILE_FIELDS}`,
          {
            method: "POST",
            headers: { "content-type": `multipart/related; boundary=${boundary}` },
            body,
          },
        );
        if (!response.ok) throw new Error(`Drive upload failed: ${response.status}`);
        return await response.json();
      },
    }),
    defineCapability({
      id: "drive.create_folder",
      title: "Create a folder",
      description: "Create a Drive folder, optionally inside another folder.",
      implementation: "google-rest-api",
      scopes: [SCOPES.drive],
      mutating: true,
      input: z.object({ name: z.string().min(1), parentFolderId: z.string().optional() }),
      run: (ctx, input) =>
        ctx.api(`${FILES}?fields=${FILE_FIELDS}&supportsAllDrives=true`, {
          body: {
            name: input.name,
            mimeType: "application/vnd.google-apps.folder",
            ...(input.parentFolderId ? { parents: [input.parentFolderId] } : {}),
          },
        }),
    }),
    defineCapability({
      id: "drive.move",
      title: "Move a file",
      description: "Move a Drive file into a different folder.",
      implementation: "google-rest-api",
      scopes: [SCOPES.drive],
      mutating: true,
      input: z.object({ fileId: z.string().min(1), targetFolderId: z.string().min(1) }),
      run: async (ctx, input) => {
        const current = await ctx.api<{ parents?: string[] }>(
          `${FILES}/${input.fileId}?fields=parents&supportsAllDrives=true`,
        );
        const params = new URLSearchParams({
          addParents: input.targetFolderId,
          removeParents: (current.parents ?? []).join(","),
          fields: FILE_FIELDS,
          supportsAllDrives: "true",
        });
        return ctx.api(`${FILES}/${input.fileId}?${params.toString()}`, { method: "PATCH", body: {} });
      },
    }),
  ],
});

export default driveAdapter;