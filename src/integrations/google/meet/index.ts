import { z } from "zod";

import { SCOPES } from "@/lib/nexus/scopes";
import { defineAdapter, defineCapability } from "@/lib/nexus/types";
import { unavailableCapability } from "@/lib/nexus/unsupported";

const BASE = "https://meet.googleapis.com/v2";

/** Meet REST API v2 — https://developers.google.com/workspace/meet/api/reference/rest/v2 */
export const meetAdapter = defineAdapter({
  service: "meet",
  label: "Google Meet",
  description: "Create and inspect Meet spaces with the official Meet REST API v2.",
  status: "partial",
  statusNote:
    "Meet REST API v2 covers spaces and (for eligible accounts) conference records. Live in-meeting control and captions are not part of the REST surface, so those stay extension points.",
  docsUrl: "https://developers.google.com/workspace/meet/api/reference/rest/v2",
  capabilities: [
    defineCapability({
      id: "meet.create_space",
      title: "Create a Meet space",
      description: "Create a Meet space and return its joinable meeting URI.",
      implementation: "google-rest-api",
      scopes: [SCOPES.meetings],
      mutating: true,
      input: z.object({}),
      run: (ctx) => ctx.api(`${BASE}/spaces`, { body: {} }),
    }),
    defineCapability({
      id: "meet.get_space",
      title: "Get a Meet space",
      description: "Read a Meet space by name (spaces/{id}) or meeting code.",
      implementation: "google-rest-api",
      scopes: [SCOPES.meetingsReadonly],
      input: z.object({ space: z.string().min(1) }),
      run: (ctx, input) => {
        const name = input.space.startsWith("spaces/") ? input.space : `spaces/${input.space}`;
        return ctx.api(`${BASE}/${name}`);
      },
    }),
    unavailableCapability({
      id: "meet.live_control",
      title: "Live meeting control",
      description: "Mute, admit or caption participants during a live meeting.",
      reason:
        "Google exposes no documented REST interface for in-meeting control; the Meet Add-ons SDK only runs inside the Meet client.",
    }),
  ],
});

export default meetAdapter;