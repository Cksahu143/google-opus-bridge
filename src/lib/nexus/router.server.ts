import { logOperation } from "./audit.server";
import { getConnection, hasScopes } from "./connections.server";
import { missingScope, notConnected, NexusError } from "./errors";
import { createAdapterContext } from "./googleClient.server";
import { findCapability } from "./registry";
import type { AdapterContext } from "./types";

export type Actor = "web" | "mcp" | "workflow";

/**
 * The single entry point every surface (dashboard, MCP tools, workflows) uses to
 * run a capability. It resolves the adapter, validates input, enforces scopes
 * and writes the audit log. Google tokens never leave this layer.
 */
export async function runCapability(params: {
  userId: string;
  capabilityId: string;
  input: unknown;
  actor: Actor;
}): Promise<unknown> {
  const entry = findCapability(params.capabilityId);
  if (!entry) {
    throw new NexusError(
      "capability_not_found",
      `Unknown capability "${params.capabilityId}". Call list_capabilities for the catalog.`,
      404,
    );
  }
  const { adapter, capability } = entry;
  const parsed = capability.input.safeParse(params.input ?? {});
  if (!parsed.success) {
    throw new NexusError(
      "invalid_input",
      `Invalid input for ${capability.id}: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`)
        .join("; ")}`,
      400,
    );
  }

  const needsGoogle = adapter.requiresGoogleAuth !== false || capability.scopes.length > 0;
  let ctx: AdapterContext;
  if (needsGoogle) {
    const connection = await getConnection(params.userId);
    if (!connection || connection.status !== "connected") throw notConnected();
    if (!hasScopes(connection.granted_scopes ?? [], capability.scopes)) {
      throw missingScope(capability.scopes);
    }
    ctx = await createAdapterContext(params.userId);
  } else {
    ctx = {
      userId: params.userId,
      api: async () => {
        throw new NexusError("no_google_context", "This capability does not use Google OAuth.", 500);
      },
      raw: async () => {
        throw new NexusError("no_google_context", "This capability does not use Google OAuth.", 500);
      },
    };
  }

  const startedAt = Date.now();
  try {
    const result = await capability.run(ctx, parsed.data as never);
    await logOperation({
      userId: params.userId,
      service: adapter.service,
      capability: capability.id,
      implementation: capability.implementation,
      actor: params.actor,
      success: true,
      durationMs: Date.now() - startedAt,
      details: { input: parsed.data },
    });
    return result;
  } catch (error) {
    await logOperation({
      userId: params.userId,
      service: adapter.service,
      capability: capability.id,
      implementation: capability.implementation,
      actor: params.actor,
      success: false,
      durationMs: Date.now() - startedAt,
      errorMessage: (error as Error).message,
      details: { input: parsed.data },
    });
    throw error;
  }
}
