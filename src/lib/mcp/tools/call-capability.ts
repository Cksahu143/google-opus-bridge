import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";

import { requireUserId, textResult } from "../nexus";

export default defineTool({
  name: "call_capability",
  title: "Call a Google capability",
  description:
    "Run any Google Nexus capability against the connected Google account. Pass the capability id from list_capabilities and its input object. This is the single entry point for reading and writing Gmail, Drive, Docs, Sheets, Slides, Calendar, Tasks, Contacts, Meet, Chat, Forms, Apps Script and the generative media adapters.",
  inputSchema: {
    capability_id: z.string().min(1).describe("Capability id, e.g. drive.search"),
    input: z.record(z.unknown()).optional().describe("Capability input object."),
  },
  annotations: { readOnlyHint: false, openWorldHint: true },
  handler: async ({ capability_id, input }, ctx) => {
    const userId = requireUserId(ctx);
    const { runCapability } = await import("@/lib/nexus/router.server");
    try {
      const result = await runCapability({
        userId,
        capabilityId: capability_id,
        input: input ?? {},
        actor: "mcp",
      });
      return textResult(result ?? { ok: true });
    } catch (error) {
      throw new ToolError((error as Error).message);
    }
  },
});
