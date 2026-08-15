import { z } from "zod";

import { SCOPES } from "@/lib/nexus/scopes";
import { defineAdapter, defineCapability } from "@/lib/nexus/types";

const BASE = "https://people.googleapis.com/v1";
const PERSON_FIELDS = "names,emailAddresses,phoneNumbers,organizations";

/** People API v1 — https://developers.google.com/people/api/rest */
export const contactsAdapter = defineAdapter({
  service: "contacts",
  label: "Google Contacts",
  description: "List, search and create contacts with the official People API.",
  status: "supported",
  statusNote: "Official People API v1 (connections list, warm search, create contact).",
  docsUrl: "https://developers.google.com/people/api/rest",
  capabilities: [
    defineCapability({
      id: "contacts.list",
      title: "List contacts",
      description: "List the account's contacts.",
      implementation: "google-rest-api",
      scopes: [SCOPES.contactsReadonly],
      input: z.object({ maxResults: z.number().int().min(1).max(200).default(50) }),
      run: (ctx, input) =>
        ctx.api(
          `${BASE}/people/me/connections?pageSize=${input.maxResults}&personFields=${PERSON_FIELDS}`,
        ),
    }),
    defineCapability({
      id: "contacts.search",
      title: "Search contacts",
      description: "Search contacts by name, email or phone.",
      implementation: "google-rest-api",
      scopes: [SCOPES.contactsReadonly],
      input: z.object({ query: z.string().min(1) }),
      run: async (ctx, input) => {
        // The People API requires a warm-up request with an empty query.
        await ctx
          .api(`${BASE}/people:searchContacts?query=&readMask=names`)
          .catch(() => undefined);
        return ctx.api(
          `${BASE}/people:searchContacts?query=${encodeURIComponent(input.query)}&readMask=${PERSON_FIELDS}`,
        );
      },
    }),
    defineCapability({
      id: "contacts.create",
      title: "Create a contact",
      description: "Create a contact with a name and optional email and phone number.",
      implementation: "google-rest-api",
      scopes: [SCOPES.contacts],
      mutating: true,
      input: z.object({
        givenName: z.string().min(1),
        familyName: z.string().optional(),
        email: z.string().email().optional(),
        phone: z.string().optional(),
      }),
      run: (ctx, input) =>
        ctx.api(`${BASE}/people:createContact`, {
          body: {
            names: [
              {
                givenName: input.givenName,
                ...(input.familyName ? { familyName: input.familyName } : {}),
              },
            ],
            ...(input.email ? { emailAddresses: [{ value: input.email }] } : {}),
            ...(input.phone ? { phoneNumbers: [{ value: input.phone }] } : {}),
          },
        }),
    }),
  ],
});

export default contactsAdapter;