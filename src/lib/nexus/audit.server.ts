import { redact, redactMessage } from "./redact";

export interface OperationLogInput {
  userId: string;
  service: string;
  capability: string;
  implementation: string;
  actor: "web" | "mcp" | "workflow";
  success: boolean;
  durationMs: number;
  errorMessage?: string;
  details?: unknown;
}

/** Append-only audit trail. Never stores tokens or credentials. */
export async function logOperation(entry: OperationLogInput): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("operation_logs").insert({
      user_id: entry.userId,
      service: entry.service,
      capability: entry.capability,
      implementation: entry.implementation,
      actor: entry.actor,
      success: entry.success,
      duration_ms: entry.durationMs,
      error_message: entry.errorMessage ? redactMessage(entry.errorMessage) : null,
      details: (redact(entry.details ?? {}) ?? {}) as Record<string, unknown>,
    });
  } catch (error) {
    // Audit failures must never break the operation itself.
    console.error("nexus: failed to write audit log", error);
  }
}