import { z } from "zod";

import { SCOPES } from "@/lib/nexus/scopes";
import { defineAdapter, defineCapability } from "@/lib/nexus/types";

const BASE = "https://classroom.googleapis.com/v1";

/**
 * Google Classroom API — official, OAuth-based, works for both teachers and
 * students on a personal Google account (no Workspace admin needed for these
 * read scopes). https://developers.google.com/workspace/classroom
 */
export const classroomAdapter = defineAdapter({
  service: "classroom",
  label: "Google Classroom",
  description: "Read courses, coursework and rosters from Google Classroom.",
  status: "supported",
  statusNote: "Official Classroom API v1, read-only scopes.",
  docsUrl: "https://developers.google.com/workspace/classroom",
  healthCheck: async (ctx) => {
    await ctx.api(`${BASE}/courses?pageSize=1`);
    return { ok: true, detail: "Classroom API reachable" };
  },
  capabilities: [
    defineCapability({
      id: "classroom.list_courses",
      title: "List courses",
      description: "List the account's Classroom courses (as teacher or student).",
      implementation: "google-rest-api",
      scopes: [SCOPES.classroomCourses],
      input: z.object({
        courseStates: z.enum(["ACTIVE", "ARCHIVED", "PROVISIONED", "DECLINED"]).default("ACTIVE"),
        pageSize: z.number().int().min(1).max(100).default(20),
      }),
      run: (ctx, input) =>
        ctx.api(`${BASE}/courses?courseStates=${input.courseStates}&pageSize=${input.pageSize}`),
    }),
    defineCapability({
      id: "classroom.list_coursework",
      title: "List coursework",
      description: "List assignments/coursework for a course.",
      implementation: "google-rest-api",
      scopes: [SCOPES.classroomCourseworkMe, SCOPES.classroomCourseworkStudents],
      input: z.object({
        courseId: z.string().min(1),
        pageSize: z.number().int().min(1).max(100).default(20),
      }),
      run: (ctx, input) =>
        ctx.api(
          `${BASE}/courses/${encodeURIComponent(input.courseId)}/courseWork?pageSize=${input.pageSize}`,
        ),
    }),
    defineCapability({
      id: "classroom.list_students",
      title: "List a course roster",
      description: "List students enrolled in a course.",
      implementation: "google-rest-api",
      scopes: [SCOPES.classroomRosters],
      input: z.object({
        courseId: z.string().min(1),
        pageSize: z.number().int().min(1).max(100).default(30),
      }),
      run: (ctx, input) =>
        ctx.api(
          `${BASE}/courses/${encodeURIComponent(input.courseId)}/students?pageSize=${input.pageSize}`,
        ),
    }),
    defineCapability({
      id: "classroom.my_coursework",
      title: "List my assigned coursework",
      description:
        "List coursework assigned to the connected account across a course (student view).",
      implementation: "google-rest-api",
      scopes: [SCOPES.classroomCourseworkMe],
      input: z.object({
        courseId: z.string().min(1),
        courseWorkId: z.string().default("-"),
      }),
      run: (ctx, input) =>
        ctx.api(
          `${BASE}/courses/${encodeURIComponent(input.courseId)}/courseWork/${encodeURIComponent(
            input.courseWorkId,
          )}/studentSubmissions?userId=me`,
        ),
    }),
  ],
});

export default classroomAdapter;
