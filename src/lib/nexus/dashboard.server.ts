import { getConnection, hasScopes } from "./connections.server";
import { createAdapterContext } from "./googleClient.server";
import { googleOAuthConfig } from "./oauth.server";
import { ADAPTERS, capabilityCatalog } from "./registry";

export async function nexusStatus(userId: string) {
  const connection = await getConnection(userId);
  const granted = connection?.granted_scopes ?? [];
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [{ data: logs }, { data: jobs }] = await Promise.all([
    supabaseAdmin
      .from("operation_logs")
      .select("id, service, capability, actor, success, duration_ms, error_message, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(25),
    supabaseAdmin
      .from("generation_jobs")
      .select("id, kind, model, status, status_detail, prompt, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  return {
    oauthConfigured: googleOAuthConfig().configured,
    geminiConfigured: Boolean(process.env["GOOGLE_AI_API_KEY"]),
    vertexProject: process.env["GOOGLE_CLOUD_PROJECT"] ?? null,
    connection: connection
      ? {
          email: connection.google_email,
          status: connection.status,
          lastError: connection.last_error,
          updatedAt: connection.updated_at,
          scopeCount: granted.length,
        }
      : null,
    services: ADAPTERS.map((adapter) => ({
      service: adapter.service,
      label: adapter.label,
      description: adapter.description,
      status: adapter.status,
      statusNote: adapter.statusNote,
      docsUrl: adapter.docsUrl,
      capabilityCount: adapter.capabilities.length,
      ready: adapter.capabilities.every((capability) => hasScopes(granted, capability.scopes)),
    })),
    capabilities: capabilityCatalog(),
    logs: logs ?? [],
    jobs: jobs ?? [],
  };
}

export async function healthCheckAll(userId: string) {
  const connection = await getConnection(userId);
  if (!connection || connection.status !== "connected") {
    return { checked: 0, results: [] as { service: string; ok: boolean; detail: string }[] };
  }
  const ctx = await createAdapterContext(userId);
  const results: { service: string; ok: boolean; detail: string }[] = [];
  for (const adapter of ADAPTERS) {
    if (!adapter.healthCheck) continue;
    try {
      const outcome = await adapter.healthCheck(ctx);
      results.push({ service: adapter.service, ...outcome });
    } catch (error) {
      results.push({ service: adapter.service, ok: false, detail: (error as Error).message });
    }
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("service_health").delete().eq("user_id", userId);
  if (results.length > 0) {
    await supabaseAdmin.from("service_health").insert(
      results.map((result) => ({
        user_id: userId,
        service: result.service,
        status: result.ok ? "ok" : "error",
        detail: result.detail,
      })),
    );
  }
  return { checked: results.length, results };
}
