import { z } from "zod";

import { SCOPES } from "@/lib/nexus/scopes";
import { defineAdapter, defineCapability } from "@/lib/nexus/types";

const BASE = "https://tasks.googleapis.com/tasks/v1";

/** Tasks API v1 — https://developers.google.com/workspace/tasks/reference/rest */
export const tasksAdapter = defineAdapter({
  service: "tasks",
  label: "Google Tasks",
  description: "Read and manage task lists and tasks with the official Tasks API.",
  status: "supported",
  statusNote: "Official Tasks API v1.",
  docsUrl: "https://developers.google.com/workspace/tasks/reference/rest",
  healthCheck: async (ctx) => {
    await ctx.api(`${BASE}/users/@me/lists?maxResults=1`);
    return { ok: true, detail: "Task lists reachable" };
  },
  capabilities: [
    defineCapability({
      id: "tasks.list_lists",
      title: "List task lists",
      description: "List the account's task lists.",
      implementation: "google-rest-api",
      scopes: [SCOPES.tasks],
      input: z.object({}),
      run: (ctx) => ctx.api(`${BASE}/users/@me/lists`),
    }),
    defineCapability({
      id: "tasks.create_tasklist",
      title: "Create a task list",
      description: "Create a new, named task list (as opposed to using the existing default list).",
      implementation: "google-rest-api",
      scopes: [SCOPES.tasks],
      mutating: true,
      input: z.object({ title: z.string().min(1) }),
      run: (ctx, input) =>
        ctx.api(`${BASE}/users/@me/lists`, {
          body: { title: input.title },
        }),
    }),
    defineCapability({
      id: "tasks.list_tasks",
      title: "List tasks",
      description: "List tasks in a task list (use '@default' for the default list).",
      implementation: "google-rest-api",
      scopes: [SCOPES.tasks],
      input: z.object({
        taskListId: z.string().default("@default"),
        showCompleted: z.boolean().default(false),
        maxResults: z.number().int().min(1).max(100).default(50),
      }),
      run: (ctx, input) =>
        ctx.api(
          `${BASE}/lists/${encodeURIComponent(input.taskListId)}/tasks?showCompleted=${input.showCompleted}&maxResults=${input.maxResults}`,
        ),
    }),
    defineCapability({
      id: "tasks.create_task",
      title: "Create a task",
      description: "Create a task with an optional note and RFC3339 due date.",
      implementation: "google-rest-api",
      scopes: [SCOPES.tasks],
      mutating: true,
      input: z.object({
        taskListId: z.string().default("@default"),
        title: z.string().min(1),
        notes: z.string().optional(),
        due: z.string().optional(),
      }),
      run: (ctx, input) =>
        ctx.api(`${BASE}/lists/${encodeURIComponent(input.taskListId)}/tasks`, {
          body: {
            title: input.title,
            ...(input.notes ? { notes: input.notes } : {}),
            ...(input.due ? { due: input.due } : {}),
          },
        }),
    }),
    defineCapability({
      id: "tasks.complete_task",
      title: "Complete a task",
      description: "Mark a task as completed.",
      implementation: "google-rest-api",
      scopes: [SCOPES.tasks],
      mutating: true,
      input: z.object({ taskListId: z.string().default("@default"), taskId: z.string().min(1) }),
      run: (ctx, input) =>
        ctx.api(`${BASE}/lists/${encodeURIComponent(input.taskListId)}/tasks/${input.taskId}`, {
          method: "PATCH",
          body: { status: "completed" },
        }),
    }),
  ],
});

export default tasksAdapter;
