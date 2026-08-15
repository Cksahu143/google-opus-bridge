import { z } from "zod";

import { SCOPES } from "@/lib/nexus/scopes";
import { defineAdapter, defineCapability } from "@/lib/nexus/types";

const BASE = "https://chat.googleapis.com/v1";

/** Google Chat API — https://developers.google.com/workspace/chat/api/reference/rest */
export const chatAdapter = defineAdapter({
  service: "chat",
  label: "Google Chat",
  description: "List spaces, read and post messages with the official Chat API (user auth).",
  status: "partial",
  statusNote:
    "Chat API works with user credentials for spaces the user is a member of. Some admin and app-only features require a Chat app or Workspace admin, which is out of scope for a user-authorised connector.",
  docsUrl: "https://developers.google.com/workspace/chat/api/reference/rest",
  capabilities: [
    defineCapability({
      id: "chat.list_spaces",
      title: "List Chat spaces",
      description: "List Chat spaces and DMs the user belongs to.",
      implementation: "google-rest-api",
      scopes: [SCOPES.chatSpaces],
      input: z.object({ maxResults: z.number().int().min(1).max(100).default(50) }),
      run: (ctx, input) => ctx.api(`${BASE}/spaces?pageSize=${input.maxResults}`),
    }),
    defineCapability({
      id: "chat.list_messages",
      title: "List messages in a space",
      description: "Read recent messages from a Chat space (spaces/{id}).",
      implementation: "google-rest-api",
      scopes: [SCOPES.chatMessages],
      input: z.object({
        space: z.string().min(1),
        maxResults: z.number().int().min(1).max(100).default(25),
      }),
      run: (ctx, input) => {
        const name = input.space.startsWith("spaces/") ? input.space : `spaces/${input.space}`;
        return ctx.api(`${BASE}/${name}/messages?pageSize=${input.maxResults}`);
      },
    }),
    defineCapability({
      id: "chat.send_message",
      title: "Post a message",
      description: "Post a text message into a Chat space the user is a member of.",
      implementation: "google-rest-api",
      scopes: [SCOPES.chatMessages],
      mutating: true,
      input: z.object({ space: z.string().min(1), text: z.string().min(1) }),
      run: (ctx, input) => {
        const name = input.space.startsWith("spaces/") ? input.space : `spaces/${input.space}`;
        return ctx.api(`${BASE}/${name}/messages`, { body: { text: input.text } });
      },
    }),
  ],
});

export default chatAdapter;