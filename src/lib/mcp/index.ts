import { auth, defineMcp, type McpDefinitionInput } from "@lovable.dev/mcp-js";

import callCapability from "./tools/call-capability";
import connectionStatus from "./tools/connection-status";
import describeCapability from "./tools/describe-capability";
import listCapabilities from "./tools/list-capabilities";

// The OAuth issuer must be the direct Supabase host; the project ref is the only
// value that survives publish unchanged.
const projectRef = import.meta.env["VITE_SUPABASE_PROJECT_ID"] ?? "project-ref-unset";

// defineTool infers `outputSchema: undefined` for tools that return plain text,
// which trips exactOptionalPropertyTypes against the definition's tool list.
const tools = [
  listCapabilities,
  describeCapability,
  callCapability,
  connectionStatus,
] as unknown as McpDefinitionInput["tools"];

export default defineMcp({
  name: "google-nexus-gateway",
  title: "Google Nexus Gateway",
  version: "1.0.0",
  instructions:
    "Google Nexus is one connection to the whole Google ecosystem for the signed-in user. Start with list_capabilities to discover capability ids, then run them with call_capability. Use connection_status when a call reports a missing connection or permission.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools,
});
