import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

import { textResult } from "../nexus";

export default defineTool({
  name: "list_capabilities",
  title: "List Google capabilities",
  description:
    "List every Google capability Google Nexus exposes (Gmail, Drive, Docs, Sheets, Slides, Calendar, Tasks, Contacts, Meet, Chat, Forms, Apps Script, Gemini, image/video/music generation, Flow projects, grounded notebooks). Call this first to discover capability ids and their input fields.",
  inputSchema: {
    service: z
      .string()
      .optional()
      .describe("Optional service filter, e.g. gmail, drive, calendar, video."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ service }) => {
    const { capabilityCatalog, ADAPTERS } = await import("@/lib/nexus/registry");
    const visibleAdapters = ADAPTERS.filter((adapter) => !adapter.hidden);
    const visibleServices = new Set(visibleAdapters.map((adapter) => adapter.service));
    const capabilities = capabilityCatalog().filter(
      (entry) => visibleServices.has(entry.service) && (!service || entry.service === service),
    );
    return textResult({
      services: visibleAdapters.map((adapter) => ({
        service: adapter.service,
        label: adapter.label,
        status: adapter.status,
        note: adapter.statusNote,
      })),
      capabilities,
    });
  },
});
