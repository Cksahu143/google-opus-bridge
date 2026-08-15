import { z } from "zod";

import { SCOPES } from "@/lib/nexus/scopes";
import { defineAdapter, defineCapability } from "@/lib/nexus/types";

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

interface GmailMessage {
  id: string;
  threadId: string;
  snippet?: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: GmailPart;
}

interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function extractBody(part: GmailPart | undefined, depth = 0): string {
  if (!part || depth > 8) return "";
  if (part.mimeType === "text/plain" && part.body?.data) return decodeBase64Url(part.body.data);
  for (const child of part.parts ?? []) {
    const text = extractBody(child, depth + 1);
    if (text) return text;
  }
  if (part.mimeType === "text/html" && part.body?.data) {
    return decodeBase64Url(part.body.data).replace(/<[^>]+>/g, " ");
  }
  return "";
}

function header(message: GmailMessage, name: string): string {
  return (
    message.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ""
  );
}

/** Gmail API v1 — https://developers.google.com/workspace/gmail/api/reference/rest */
export const gmailAdapter = defineAdapter({
  service: "gmail",
  label: "Gmail",
  description: "Search, read, send and label mail through the official Gmail API.",
  status: "supported",
  statusNote: "Official Gmail API v1 with Gmail search syntax.",
  docsUrl: "https://developers.google.com/workspace/gmail/api/reference/rest",
  healthCheck: async (ctx) => {
    const profile = await ctx.api<{ emailAddress: string; messagesTotal: number }>(
      `${BASE}/profile`,
    );
    return { ok: true, detail: `Mailbox ${profile.emailAddress} reachable` };
  },
  capabilities: [
    defineCapability({
      id: "gmail.search",
      title: "Search mail",
      description:
        "Search the mailbox using Gmail search syntax (e.g. 'from:alice has:attachment newer_than:7d') and return message summaries.",
      implementation: "google-rest-api",
      scopes: [SCOPES.gmailReadonly],
      input: z.object({
        query: z.string().min(1),
        maxResults: z.number().int().min(1).max(50).default(10),
      }),
      run: async (ctx, input) => {
        const list = await ctx.api<{ messages?: { id: string }[] }>(
          `${BASE}/messages?q=${encodeURIComponent(input.query)}&maxResults=${input.maxResults}`,
        );
        const ids = (list.messages ?? []).map((m) => m.id);
        const messages = await Promise.all(
          ids.map((id) =>
            ctx.api<GmailMessage>(
              `${BASE}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
            ),
          ),
        );
        return {
          messages: messages.map((message) => ({
            id: message.id,
            threadId: message.threadId,
            from: header(message, "From"),
            to: header(message, "To"),
            subject: header(message, "Subject"),
            date: header(message, "Date"),
            snippet: message.snippet ?? "",
            labels: message.labelIds ?? [],
          })),
        };
      },
    }),
    defineCapability({
      id: "gmail.read",
      title: "Read a message",
      description: "Read one Gmail message including its plain-text body.",
      implementation: "google-rest-api",
      scopes: [SCOPES.gmailReadonly],
      input: z.object({
        messageId: z.string().min(1),
        maxCharacters: z.number().int().min(500).max(100_000).default(20_000),
      }),
      run: async (ctx, input) => {
        const message = await ctx.api<GmailMessage>(
          `${BASE}/messages/${input.messageId}?format=full`,
        );
        const body = extractBody(message.payload);
        return {
          id: message.id,
          threadId: message.threadId,
          from: header(message, "From"),
          to: header(message, "To"),
          cc: header(message, "Cc"),
          subject: header(message, "Subject"),
          date: header(message, "Date"),
          labels: message.labelIds ?? [],
          truncated: body.length > input.maxCharacters,
          body: body.slice(0, input.maxCharacters),
        };
      },
    }),
    defineCapability({
      id: "gmail.list_labels",
      title: "List labels",
      description: "List the mailbox labels.",
      implementation: "google-rest-api",
      scopes: [SCOPES.gmailReadonly],
      input: z.object({}),
      run: (ctx) => ctx.api(`${BASE}/labels`),
    }),
    defineCapability({
      id: "gmail.send",
      title: "Send mail",
      description: "Send a plain-text email from the connected account.",
      implementation: "google-rest-api",
      scopes: [SCOPES.gmailSend],
      mutating: true,
      input: z.object({
        to: z.string().min(3),
        subject: z.string().default(""),
        body: z.string().default(""),
        cc: z.string().optional(),
        replyToMessageId: z.string().optional(),
      }),
      run: async (ctx, input) => {
        const lines = [
          `To: ${input.to}`,
          ...(input.cc ? [`Cc: ${input.cc}`] : []),
          `Subject: ${input.subject}`,
          "MIME-Version: 1.0",
          'Content-Type: text/plain; charset="UTF-8"',
          "",
          input.body,
        ];
        const rawMessage = Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
        return ctx.api(`${BASE}/messages/send`, {
          body: {
            raw: rawMessage,
            ...(input.replyToMessageId ? { threadId: input.replyToMessageId } : {}),
          },
        });
      },
    }),
    defineCapability({
      id: "gmail.modify_labels",
      title: "Add or remove labels",
      description: "Add or remove labels on a message (archive with removeLabelIds: ['INBOX']).",
      implementation: "google-rest-api",
      scopes: [SCOPES.gmailModify],
      mutating: true,
      input: z.object({
        messageId: z.string().min(1),
        addLabelIds: z.array(z.string()).default([]),
        removeLabelIds: z.array(z.string()).default([]),
      }),
      run: (ctx, input) =>
        ctx.api(`${BASE}/messages/${input.messageId}/modify`, {
          body: { addLabelIds: input.addLabelIds, removeLabelIds: input.removeLabelIds },
        }),
    }),
  ],
});

export default gmailAdapter;