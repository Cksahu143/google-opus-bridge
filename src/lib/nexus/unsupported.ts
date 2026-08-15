import { z } from "zod";

import { capabilityUnavailable } from "./errors";
import { defineCapability, type Capability, type ImplementationKind } from "./types";

/**
 * Extension point for products that have no reliable documented interface yet.
 * The capability is registered so the router, dashboard and MCP surface can
 * report it honestly — calling it always fails loudly instead of pretending.
 * Swapping in a real implementation means editing only that one adapter.
 */
export function unavailableCapability(params: {
  id: string;
  title: string;
  description: string;
  reason: string;
  implementation?: ImplementationKind;
}): Capability<never, unknown> {
  return defineCapability({
    id: params.id,
    title: params.title,
    description: params.description,
    implementation: params.implementation ?? "unavailable",
    scopes: [],
    input: z.unknown(),
    run: async () => {
      throw capabilityUnavailable(params.id, params.reason);
    },
  });
}