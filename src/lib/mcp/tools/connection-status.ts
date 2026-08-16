import { defineTool } from "@lovable.dev/mcp-js";

import { requireUserId, textResult } from "../nexus";

export default defineTool({
  name: "connection_status",
  title: "Google connection status",
  description:
    "Report which Google account is connected, whether its grant is healthy, and which services are ready. Use this when a call fails with a connection or permission error.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    const userId = requireUserId(ctx);
    const { nexusStatus } = await import("@/lib/nexus/dashboard.server");
    const status = await nexusStatus(userId);
    return textResult({
      connection: status.connection,
      oauthConfigured: status.oauthConfigured,
      geminiConfigured: status.geminiConfigured,
      services: status.services.map((service) => ({
        service: service.service,
        status: service.status,
        ready: service.ready,
      })),
    });
  },
});
