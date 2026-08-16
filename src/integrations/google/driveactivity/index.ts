import { z } from "zod";

import { SCOPES } from "@/lib/nexus/scopes";
import { defineAdapter, defineCapability } from "@/lib/nexus/types";

const BASE = "https://driveactivity.googleapis.com/v2:query";

/**
 * Drive Activity API v2 — official, answers "what changed and who changed
 * it" for Drive, which the plain Drive API does not expose directly.
 * https://developers.google.com/drive/activity/v2
 */
export const driveActivityAdapter = defineAdapter({
  service: "driveactivity",
  label: "Drive Activity",
  description:
    "See recent changes (edits, comments, moves, permission changes) across Drive or one file.",
  status: "supported",
  statusNote: "Official Drive Activity API v2, read-only scope.",
  docsUrl: "https://developers.google.com/drive/activity/v2",
  healthCheck: async (ctx) => {
    await ctx.api(BASE, { body: { pageSize: 1 } });
    return { ok: true, detail: "Drive Activity API reachable" };
  },
  capabilities: [
    defineCapability({
      id: "driveactivity.recent",
      title: "Recent Drive activity",
      description:
        "List recent activity across the whole Drive (or scoped to one item/ancestor folder).",
      implementation: "google-rest-api",
      scopes: [SCOPES.driveActivity],
      input: z.object({
        itemName: z.string().optional().describe("e.g. 'items/<fileId>' to scope to one file"),
        ancestorName: z
          .string()
          .optional()
          .describe("e.g. 'items/<folderId>' to scope to a folder"),
        pageSize: z.number().int().min(1).max(50).default(20),
      }),
      run: (ctx, input) =>
        ctx.api(BASE, {
          body: {
            pageSize: input.pageSize,
            ...(input.itemName ? { itemName: input.itemName } : {}),
            ...(input.ancestorName ? { ancestorName: input.ancestorName } : {}),
          },
        }),
    }),
  ],
});

export default driveActivityAdapter;
