import { z } from "zod";

import { SCOPES } from "@/lib/nexus/scopes";
import { defineAdapter, defineCapability } from "@/lib/nexus/types";
import { unavailableCapability } from "@/lib/nexus/unsupported";

const BASE = "https://script.googleapis.com/v1/projects";

/**
 * Apps Script API — https://developers.google.com/apps-script/api/reference/rest
 * This is the escape hatch for Google surfaces that have no REST API but do
 * have Apps Script services (for example Google Keep via the Keep Apps Script
 * advanced service in Workspace domains).
 */
export const appsScriptAdapter = defineAdapter({
  service: "appsscript",
  label: "Google Apps Script",
  description: "Manage Apps Script projects — the escape hatch for APIs Google only exposes there.",
  status: "partial",
  statusNote:
    "Project create/read/update work with the Apps Script API. Executing a script (scripts.run) additionally requires the script to be deployed as an API executable in a Cloud project that shares the OAuth client, so it is left as an explicit extension point rather than a silent failure.",
  docsUrl: "https://developers.google.com/apps-script/api/reference/rest",
  capabilities: [
    defineCapability({
      id: "appsscript.create_project",
      title: "Create a script project",
      description: "Create a standalone Apps Script project.",
      implementation: "google-apps-script",
      scopes: [SCOPES.script],
      mutating: true,
      input: z.object({ title: z.string().min(1), parentId: z.string().optional() }),
      run: (ctx, input) =>
        ctx.api(BASE, {
          body: { title: input.title, ...(input.parentId ? { parentId: input.parentId } : {}) },
        }),
    }),
    defineCapability({
      id: "appsscript.get_content",
      title: "Read script content",
      description: "Read the files of an Apps Script project.",
      implementation: "google-apps-script",
      scopes: [SCOPES.script],
      input: z.object({ scriptId: z.string().min(1) }),
      run: (ctx, input) => ctx.api(`${BASE}/${input.scriptId}/content`),
    }),
    defineCapability({
      id: "appsscript.update_content",
      title: "Write script content",
      description:
        "Replace the files of an Apps Script project. Provide files as {name, type: SERVER_JS|HTML|JSON, source}.",
      implementation: "google-apps-script",
      scopes: [SCOPES.script],
      mutating: true,
      input: z.object({
        scriptId: z.string().min(1),
        files: z
          .array(
            z.object({
              name: z.string().min(1),
              type: z.enum(["SERVER_JS", "HTML", "JSON"]),
              source: z.string(),
            }),
          )
          .min(1),
      }),
      run: (ctx, input) =>
        ctx.api(`${BASE}/${input.scriptId}/content`, {
          method: "PUT",
          body: { files: input.files },
        }),
    }),
    unavailableCapability({
      id: "appsscript.run",
      title: "Execute a script function",
      description: "Run a deployed Apps Script function and return its result.",
      implementation: "google-apps-script",
      reason:
        "scripts.run requires the script to be deployed as an API executable under the same Cloud project as this connector's OAuth client. Wire that deployment, then implement this capability in the appsscript adapter only.",
    }),
  ],
});

export default appsScriptAdapter;