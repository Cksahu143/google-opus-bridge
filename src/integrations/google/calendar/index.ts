import { z } from "zod";

import { SCOPES } from "@/lib/nexus/scopes";
import { defineAdapter, defineCapability } from "@/lib/nexus/types";

const BASE = "https://www.googleapis.com/calendar/v3";

/** Calendar API v3 — https://developers.google.com/workspace/calendar/api/v3/reference */
export const calendarAdapter = defineAdapter({
  service: "calendar",
  label: "Google Calendar",
  description: "List, create, update and delete calendar events with the official Calendar API.",
  status: "supported",
  statusNote: "Official Calendar API v3, including Meet link creation on new events.",
  docsUrl: "https://developers.google.com/workspace/calendar/api/v3/reference",
  healthCheck: async (ctx) => {
    await ctx.api(`${BASE}/users/me/calendarList?maxResults=1`);
    return { ok: true, detail: "Calendar list reachable" };
  },
  capabilities: [
    defineCapability({
      id: "calendar.list_calendars",
      title: "List calendars",
      description: "List the calendars the account can access.",
      implementation: "google-rest-api",
      scopes: [SCOPES.calendar],
      input: z.object({}),
      run: (ctx) => ctx.api(`${BASE}/users/me/calendarList`),
    }),
    defineCapability({
      id: "calendar.list_events",
      title: "List events",
      description:
        "List events in a time window (RFC3339 timestamps). Defaults to the next 7 days of the primary calendar.",
      implementation: "google-rest-api",
      scopes: [SCOPES.calendar],
      input: z.object({
        calendarId: z.string().default("primary"),
        timeMin: z.string().optional(),
        timeMax: z.string().optional(),
        query: z.string().optional(),
        maxResults: z.number().int().min(1).max(100).default(25),
      }),
      run: async (ctx, input) => {
        const params = new URLSearchParams({
          singleEvents: "true",
          orderBy: "startTime",
          maxResults: String(input.maxResults),
          timeMin: input.timeMin ?? new Date().toISOString(),
          timeMax:
            input.timeMax ?? new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
        });
        if (input.query) params.set("q", input.query);
        const res = await ctx.api<{ items?: unknown[] }>(
          `${BASE}/calendars/${encodeURIComponent(input.calendarId)}/events?${params.toString()}`,
        );
        return { events: res.items ?? [] };
      },
    }),
    defineCapability({
      id: "calendar.create_event",
      title: "Create an event",
      description:
        "Create a calendar event. Set addMeetLink to attach a Google Meet conference to the event.",
      implementation: "google-rest-api",
      scopes: [SCOPES.calendar],
      mutating: true,
      input: z.object({
        calendarId: z.string().default("primary"),
        summary: z.string().min(1),
        description: z.string().optional(),
        location: z.string().optional(),
        start: z.string().describe("RFC3339 start, e.g. 2026-09-01T10:00:00Z"),
        end: z.string().describe("RFC3339 end"),
        timeZone: z.string().optional(),
        attendees: z.array(z.string().email()).default([]),
        addMeetLink: z.boolean().default(false),
      }),
      run: async (ctx, input) => {
        const params = new URLSearchParams({ conferenceDataVersion: input.addMeetLink ? "1" : "0" });
        return ctx.api(
          `${BASE}/calendars/${encodeURIComponent(input.calendarId)}/events?${params.toString()}`,
          {
            body: {
              summary: input.summary,
              ...(input.description ? { description: input.description } : {}),
              ...(input.location ? { location: input.location } : {}),
              start: { dateTime: input.start, ...(input.timeZone ? { timeZone: input.timeZone } : {}) },
              end: { dateTime: input.end, ...(input.timeZone ? { timeZone: input.timeZone } : {}) },
              attendees: input.attendees.map((email) => ({ email })),
              ...(input.addMeetLink
                ? {
                    conferenceData: {
                      createRequest: {
                        requestId: `nexus-${Date.now().toString(36)}`,
                        conferenceSolutionKey: { type: "hangoutsMeet" },
                      },
                    },
                  }
                : {}),
            },
          },
        );
      },
    }),
    defineCapability({
      id: "calendar.update_event",
      title: "Update an event",
      description: "Patch fields of an existing event.",
      implementation: "google-rest-api",
      scopes: [SCOPES.calendar],
      mutating: true,
      input: z.object({
        calendarId: z.string().default("primary"),
        eventId: z.string().min(1),
        summary: z.string().optional(),
        description: z.string().optional(),
        start: z.string().optional(),
        end: z.string().optional(),
      }),
      run: (ctx, input) =>
        ctx.api(
          `${BASE}/calendars/${encodeURIComponent(input.calendarId)}/events/${input.eventId}`,
          {
            method: "PATCH",
            body: {
              ...(input.summary ? { summary: input.summary } : {}),
              ...(input.description ? { description: input.description } : {}),
              ...(input.start ? { start: { dateTime: input.start } } : {}),
              ...(input.end ? { end: { dateTime: input.end } } : {}),
            },
          },
        ),
    }),
    defineCapability({
      id: "calendar.delete_event",
      title: "Delete an event",
      description: "Delete an event from a calendar.",
      implementation: "google-rest-api",
      scopes: [SCOPES.calendar],
      mutating: true,
      input: z.object({ calendarId: z.string().default("primary"), eventId: z.string().min(1) }),
      run: async (ctx, input) => {
        const response = await ctx.raw(
          `${BASE}/calendars/${encodeURIComponent(input.calendarId)}/events/${input.eventId}`,
          { method: "DELETE" },
        );
        if (!response.ok && response.status !== 410) {
          throw new Error(`Calendar delete failed: ${response.status}`);
        }
        return { deleted: true };
      },
    }),
  ],
});

export default calendarAdapter;