import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";

import { textResult } from "../nexus";

export default defineTool({
  name: "describe_capability",
  title: "Describe a capability",
  description: "Show the full input contract, required Google scopes and docs link for one capability id.",
  inputSchema: { capability_id: z.string().min(1).describe("Capability id, e.g. gmail.send") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ capability_id }) => {
    const { capabilityCatalog, findCapability } = await import("@/lib/nexus/registry");
    const entry = findCapability(capability_id);
    if (!entry) {
      throw new ToolError(
        `Unknown capability "${capability_id}". Known ids: ${capabilityCatalog()
          .map((item) => item.id)
          .join(", ")}`,
      );
    }
    return textResult({
      id: entry.capability.id,
      title: entry.capability.title,
      description: entry.capability.description,
      service: entry.adapter.service,
      serviceStatus: entry.adapter.status,
      statusNote: entry.adapter.statusNote,
      docsUrl: entry.adapter.docsUrl,
      mutating: Boolean(entry.capability.mutating),
      scopes: entry.capability.scopes,
      input: capabilityCatalog().find((item) => item.id === capability_id)?.inputSchema,
    });
  },
});
