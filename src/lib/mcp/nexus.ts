import { ToolError, type ToolContext } from "@lovable.dev/mcp-js";

/** Resolves the Supabase user id from the verified OAuth token. */
export function requireUserId(ctx: ToolContext): string {
  if (!ctx.isAuthenticated()) {
    throw new ToolError("Not signed in. Reconnect this Google Nexus connector and approve access.");
  }
  const userId = ctx.getUserId();
  if (!userId) throw new ToolError("The access token carries no user id.");
  return userId;
}

export function textResult(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}
