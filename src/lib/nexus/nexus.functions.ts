import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Thin server-function wrappers. All runtime logic lives in *.server modules so
 * the client bundle never pulls server-only code.
 */
export const getNexusStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { nexusStatus } = await import("./dashboard.server");
    return nexusStatus(context.userId);
  });

export const startGoogleConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { beginGoogleConnect } = await import("./connect.server");
    return beginGoogleConnect(context.userId);
  });

export const disconnectGoogle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { disconnect } = await import("./connections.server");
    await disconnect(context.userId);
    return { ok: true };
  });

export const runNexusCapability = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ capabilityId: z.string().min(1), input: z.unknown().optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { runCapability } = await import("./router.server");
    try {
      const result = await runCapability({
        userId: context.userId,
        capabilityId: data.capabilityId,
        input: data.input ?? {},
        actor: "web",
      });
      return {
        ok: true as const,
        resultJson: JSON.stringify(result ?? null, null, 2),
        error: null,
      };
    } catch (error) {
      return { ok: false as const, resultJson: null, error: (error as Error).message };
    }
  });

export const runNexusHealthChecks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { healthCheckAll } = await import("./dashboard.server");
    return healthCheckAll(context.userId);
  });

interface NotebookSummary {
  id: string;
  title: string;
  description: string | null;
  drive_folder_id: string | null;
  created_at: string;
  updated_at: string;
  sourceCount: number;
  url: string;
}

export const listNotebooks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { runCapability } = await import("./router.server");
    try {
      const result = (await runCapability({
        userId: context.userId,
        capabilityId: "notebook.list",
        input: {},
        actor: "web",
      })) as { notebooks: NotebookSummary[] };
      return { ok: true as const, notebooks: result.notebooks, error: null as string | null };
    } catch (error) {
      return {
        ok: false as const,
        notebooks: [] as NotebookSummary[],
        error: (error as Error).message as string | null,
      };
    }
  });

interface NotebookSourceSummary {
  id: string;
  kind: string;
  title: string;
  reference: string | null;
  char_count: number;
}

interface NotebookDetail {
  notebook: {
    id: string;
    title: string;
    description: string | null;
    created_at: string;
    updated_at: string;
  };
  url: string;
  sources: NotebookSourceSummary[];
}

export const getNotebook = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ notebookId: z.string().min(1) }).parse(input))
  .handler(async ({ data, context }) => {
    const { runCapability } = await import("./router.server");
    try {
      const result = (await runCapability({
        userId: context.userId,
        capabilityId: "notebook.get",
        input: { notebookId: data.notebookId },
        actor: "web",
      })) as NotebookDetail;
      return { ok: true as const, result, error: null as string | null };
    } catch (error) {
      return {
        ok: false as const,
        result: null as NotebookDetail | null,
        error: (error as Error).message as string | null,
      };
    }
  });
