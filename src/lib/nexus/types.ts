import type { z } from "zod";

/**
 * How a capability is actually implemented. Claude never sees this — it is for
 * the dashboard, health checks and the router.
 */
export type ImplementationKind =
  | "google-rest-api"
  | "google-apps-script"
  | "gemini-api"
  | "mcp-server"
  | "browser-automation"
  | "unavailable";

export type ServiceStatus =
  /** Fully implemented against a documented Google API. */
  | "supported"
  /** Implemented, but only part of the product surface is reachable. */
  | "partial"
  /** Implemented but requires extra credentials/config before it works. */
  | "requires-configuration"
  /** No reliable documented interface exists today. Extension point only. */
  | "unsupported";

export interface AdapterContext {
  userId: string;
  /** Authenticated JSON call against a Google endpoint. */
  api: <T = unknown>(
    url: string,
    init?: {
      method?: string | undefined;
      body?: unknown;
      headers?: Record<string, string> | undefined;
    },
  ) => Promise<T>;
  /** Raw authenticated fetch (media downloads, uploads). */
  raw: (url: string, init?: RequestInit) => Promise<Response>;
}

export interface Capability<TInput = unknown, TOutput = unknown> {
  /** Stable dotted id, e.g. `gmail.search`. */
  id: string;
  title: string;
  description: string;
  implementation: ImplementationKind;
  /** OAuth scopes required for this capability. */
  scopes: string[];
  /** Mutating capabilities are gated by the permission system. */
  mutating?: boolean | undefined;
  input: z.ZodType<TInput, z.ZodTypeDef, unknown>;
  run: (ctx: AdapterContext, input: TInput) => Promise<TOutput>;
}

export interface GoogleAdapter {
  /** Service key, matches the folder name under src/integrations/google. */
  service: string;
  label: string;
  description: string;
  status: ServiceStatus;
  /** Honest note about what is and is not possible today. */
  statusNote: string;
  /** Official documentation this adapter was built from. */
  docsUrl: string;
  capabilities: Capability<never, unknown>[];
  /** Cheap request proving the API is reachable with the user's grant. */
  healthCheck?: undefined | ((ctx: AdapterContext) => Promise<{ ok: boolean; detail: string }>);
}

export function defineAdapter(adapter: GoogleAdapter): GoogleAdapter {
  return adapter;
}

export function defineCapability<TInput, TOutput>(
  capability: Capability<TInput, TOutput>,
): Capability<never, unknown> {
  return capability as unknown as Capability<never, unknown>;
}