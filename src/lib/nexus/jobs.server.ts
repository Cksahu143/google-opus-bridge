import { redactMessage } from "./redact";

export type JobKind = "image" | "video" | "music" | "flow";
export type JobStatus = "queued" | "running" | "completed" | "failed";

export interface GenerationJob {
  id: string;
  user_id: string;
  kind: JobKind;
  provider: string;
  model: string;
  prompt: string;
  parameters: Record<string, unknown>;
  status: JobStatus;
  status_detail: string | null;
  operation_name: string | null;
  result: Record<string, unknown> | null;
  error_message: string | null;
  actor: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function createJob(params: {
  userId: string;
  kind: JobKind;
  provider: string;
  model: string;
  prompt: string;
  parameters?: Record<string, unknown>;
  status?: JobStatus;
  statusDetail?: string;
  operationName?: string | null;
  result?: Record<string, unknown> | null;
  actor?: string;
}): Promise<GenerationJob> {
  const client = await db();
  const { data, error } = await client
    .from("generation_jobs")
    .insert({
      user_id: params.userId,
      kind: params.kind,
      provider: params.provider,
      model: params.model,
      prompt: params.prompt,
      parameters: params.parameters ?? {},
      status: params.status ?? "queued",
      status_detail: params.statusDetail ?? null,
      operation_name: params.operationName ?? null,
      result: params.result ?? null,
      actor: params.actor ?? "web",
      ...(params.status === "completed" ? { completed_at: new Date().toISOString() } : {}),
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as GenerationJob;
}

export async function updateJob(
  jobId: string,
  patch: {
    status?: JobStatus;
    statusDetail?: string | null;
    result?: Record<string, unknown> | null;
    errorMessage?: string | null;
    operationName?: string | null;
  },
): Promise<GenerationJob> {
  const client = await db();
  const { data, error } = await client
    .from("generation_jobs")
    .update({
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.statusDetail === undefined ? {} : { status_detail: patch.statusDetail }),
      ...(patch.result === undefined ? {} : { result: patch.result }),
      ...(patch.operationName === undefined ? {} : { operation_name: patch.operationName }),
      ...(patch.errorMessage === undefined
        ? {}
        : { error_message: patch.errorMessage ? redactMessage(patch.errorMessage) : null }),
      ...(patch.status === "completed" || patch.status === "failed"
        ? { completed_at: new Date().toISOString() }
        : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .select("*")
    .single();
  if (error) throw error;
  return data as GenerationJob;
}

export async function getJob(userId: string, jobId: string): Promise<GenerationJob | null> {
  const client = await db();
  const { data, error } = await client
    .from("generation_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as GenerationJob | null) ?? null;
}

export async function listJobs(
  userId: string,
  options: { kind?: JobKind; limit?: number } = {},
): Promise<GenerationJob[]> {
  const client = await db();
  let query = client
    .from("generation_jobs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 25);
  if (options.kind) query = query.eq("kind", options.kind);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as GenerationJob[];
}

/** Public job shape — never leaks credentials or raw provider payloads. */
export function publicJob(job: GenerationJob) {
  return {
    jobId: job.id,
    kind: job.kind,
    status: job.status,
    statusDetail: job.status_detail,
    model: job.model,
    prompt: job.prompt,
    parameters: job.parameters,
    result: job.result,
    error: job.error_message,
    createdAt: job.created_at,
    completedAt: job.completed_at,
  };
}