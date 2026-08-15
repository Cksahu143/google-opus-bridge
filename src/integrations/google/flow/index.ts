import { z } from "zod";

import { ensureNexusFolder } from "@/lib/nexus/driveAssets.server";
import { NexusError } from "@/lib/nexus/errors";
import { collectText, geminiGenerateContent } from "@/lib/nexus/gemini.server";
import { createJob, getJob, listJobs, publicJob, updateJob } from "@/lib/nexus/jobs.server";
import { SCOPES } from "@/lib/nexus/scopes";
import { defineAdapter, defineCapability, type AdapterContext } from "@/lib/nexus/types";
import veoAdapter from "../veo";

/**
 * Flow-style filmmaking. Google's Flow product has no public API, so Nexus
 * implements the same workflow itself: a Drive-backed project holding a shot
 * list, per-shot Veo clips, and an assembled edit manifest. Everything runs on
 * documented APIs (Drive + Veo), so Claude gets the capability without needing
 * Flow's private interface.
 */
const PROJECT_MIME = "application/json";
const PROJECT_FILE = "flow-project.json";

interface FlowShot {
  id: string;
  prompt: string;
  durationHint: string | null;
  jobId: string | null;
  status: string;
  clip: Record<string, unknown> | null;
}

interface FlowProject {
  version: 1;
  projectId: string;
  title: string;
  logline: string;
  aspectRatio: "16:9" | "9:16";
  folderId: string;
  shots: FlowShot[];
  createdAt: string;
  updatedAt: string;
}

const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";

async function findProjectFile(ctx: AdapterContext, folderId: string): Promise<string | null> {
  const query = `name='${PROJECT_FILE}' and '${folderId}' in parents and trashed=false`;
  const found = await ctx.api<{ files?: { id: string }[] }>(
    `${DRIVE_FILES}?q=${encodeURIComponent(query)}&fields=files(id)&pageSize=1`,
  );
  return found.files?.[0]?.id ?? null;
}

async function writeProject(ctx: AdapterContext, project: FlowProject): Promise<FlowProject> {
  const next = { ...project, updatedAt: new Date().toISOString() };
  const body = JSON.stringify(next, null, 2);
  const existing = await findProjectFile(ctx, project.folderId);
  if (existing) {
    const response = await ctx.raw(
      `https://www.googleapis.com/upload/drive/v3/files/${existing}?uploadType=media`,
      { method: "PATCH", headers: { "content-type": PROJECT_MIME }, body },
    );
    if (!response.ok) {
      throw new NexusError("flow_write_failed", `Could not save the Flow project (${response.status}).`, 502);
    }
    return next;
  }
  const boundary = `nexus-${Math.random().toString(36).slice(2)}`;
  const metadata = JSON.stringify({
    name: PROJECT_FILE,
    mimeType: PROJECT_MIME,
    parents: [project.folderId],
  });
  const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${PROJECT_MIME}\r\n\r\n${body}\r\n--${boundary}--\r\n`;
  const response = await ctx.raw(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    {
      method: "POST",
      headers: { "content-type": `multipart/related; boundary=${boundary}` },
      body: multipart,
    },
  );
  if (!response.ok) {
    throw new NexusError("flow_write_failed", `Could not create the Flow project (${response.status}).`, 502);
  }
  return next;
}

async function readProject(ctx: AdapterContext, folderId: string): Promise<FlowProject> {
  const fileId = await findProjectFile(ctx, folderId);
  if (!fileId) {
    throw new NexusError(
      "flow_project_not_found",
      `No Flow project found in Drive folder ${folderId}. Create one with flow.create_project.`,
      404,
    );
  }
  const response = await ctx.raw(`${DRIVE_FILES}/${fileId}?alt=media`);
  if (!response.ok) {
    throw new NexusError("flow_read_failed", `Could not read the Flow project (${response.status}).`, 502);
  }
  return (await response.json()) as FlowProject;
}

function capability(id: string) {
  const found = veoAdapter.capabilities.find((entry) => entry.id === id);
  if (!found) throw new NexusError("flow_internal", `Missing video capability ${id}`, 500);
  return found;
}

async function generateShot(
  ctx: AdapterContext,
  params: { prompt: string; aspectRatio: "16:9" | "9:16"; folderId: string },
) {
  const generate = capability("video.generate");
  const parsed = generate.input.parse({
    prompt: params.prompt,
    aspectRatio: params.aspectRatio,
    saveToDrive: true,
    driveFolderId: params.folderId,
  }) as never;
  return (await generate.run(ctx, parsed)) as { jobId: string; status: string };
}

export const flowAdapter = defineAdapter({
  service: "flow",
  label: "Flow-style video projects",
  description:
    "Multi-shot video projects: shot lists, per-shot Veo clips and an assembled edit manifest, all stored in Drive.",
  status: "partial",
  statusNote:
    "Google Flow has no public API, so Nexus reimplements the workflow on documented APIs: Drive holds the project and clips, Veo renders each shot, Gemini drafts shot lists. Frame-accurate timeline rendering is not possible without a public Flow interface, so the assembled output is an edit manifest plus the individual clips.",
  docsUrl: "https://ai.google.dev/gemini-api/docs/video",
  capabilities: [
    defineCapability({
      id: "flow.create_project",
      title: "Create a video project",
      description:
        "Create a Drive-backed video project. Optionally let Gemini draft a shot list from the logline.",
      implementation: "google-rest-api",
      scopes: [SCOPES.drive],
      mutating: true,
      input: z.object({
        title: z.string().min(1),
        logline: z.string().default(""),
        aspectRatio: z.enum(["16:9", "9:16"]).default("16:9"),
        shots: z.array(z.string().min(1)).default([]),
        draftShotCount: z.number().int().min(0).max(8).default(0),
      }),
      run: async (ctx, input) => {
        const root = await ensureNexusFolder(ctx, "Google Nexus Generations");
        const folderId = await ensureNexusFolder(ctx, `Flow — ${input.title}`, root);

        let prompts = input.shots;
        if (prompts.length === 0 && input.draftShotCount > 0) {
          const drafted = collectText(
            await geminiGenerateContent("gemini-2.5-flash", {
              contents: [
                {
                  role: "user",
                  parts: [
                    {
                      text: `Write exactly ${input.draftShotCount} cinematic shot descriptions for a short film titled "${input.title}". Logline: ${input.logline}. Return one shot per line, no numbering, each a single vivid sentence describing camera, subject and lighting.`,
                    },
                  ],
                },
              ],
            }),
          );
          prompts = drafted
            .split("\n")
            .map((line) => line.replace(/^[\s\d.•-]+/, "").trim())
            .filter(Boolean)
            .slice(0, input.draftShotCount);
        }

        const now = new Date().toISOString();
        const project = await writeProject(ctx, {
          version: 1,
          projectId: folderId,
          title: input.title,
          logline: input.logline,
          aspectRatio: input.aspectRatio,
          folderId,
          shots: prompts.map((prompt, index) => ({
            id: `shot-${index + 1}`,
            prompt,
            durationHint: null,
            jobId: null,
            status: "planned",
            clip: null,
          })),
          createdAt: now,
          updatedAt: now,
        });
        return project;
      },
    }),
    defineCapability({
      id: "flow.get_project",
      title: "Get a video project",
      description: "Read a Flow project, refreshing the status of any rendering shots.",
      implementation: "google-rest-api",
      scopes: [SCOPES.drive],
      input: z.object({ projectId: z.string().min(1) }),
      run: async (ctx, input) => {
        const project = await readProject(ctx, input.projectId);
        const status = capability("video.status");
        let changed = false;
        for (const shot of project.shots) {
          if (!shot.jobId || shot.status === "completed" || shot.status === "failed") continue;
          const job = (await status.run(ctx, status.input.parse({ jobId: shot.jobId }) as never)) as {
            status: string;
            result?: { clips?: Record<string, unknown>[] } | null;
          };
          shot.status = job.status;
          shot.clip = job.result?.clips?.[0] ?? shot.clip;
          changed = true;
        }
        return changed ? writeProject(ctx, project) : project;
      },
    }),
    defineCapability({
      id: "flow.add_shot",
      title: "Add a shot",
      description: "Append a shot to a project, optionally starting its render immediately.",
      implementation: "google-rest-api",
      scopes: [SCOPES.drive],
      mutating: true,
      input: z.object({
        projectId: z.string().min(1),
        prompt: z.string().min(1),
        render: z.boolean().default(false),
      }),
      run: async (ctx, input) => {
        const project = await readProject(ctx, input.projectId);
        const shot: FlowShot = {
          id: `shot-${project.shots.length + 1}`,
          prompt: input.prompt,
          durationHint: null,
          jobId: null,
          status: "planned",
          clip: null,
        };
        if (input.render) {
          const job = await generateShot(ctx, {
            prompt: input.prompt,
            aspectRatio: project.aspectRatio,
            folderId: project.folderId,
          });
          shot.jobId = job.jobId;
          shot.status = job.status;
        }
        project.shots.push(shot);
        return writeProject(ctx, project);
      },
    }),
    defineCapability({
      id: "flow.render_project",
      title: "Render a project",
      description:
        "Start Veo renders for every shot that has not been rendered yet. Poll progress with flow.get_project.",
      implementation: "gemini-api",
      scopes: [SCOPES.drive],
      mutating: true,
      input: z.object({
        projectId: z.string().min(1),
        rerenderFailed: z.boolean().default(true),
      }),
      run: async (ctx, input) => {
        const project = await readProject(ctx, input.projectId);
        let started = 0;
        for (const shot of project.shots) {
          const needsRender =
            shot.status === "planned" || (input.rerenderFailed && shot.status === "failed");
          if (!needsRender) continue;
          const job = await generateShot(ctx, {
            prompt: shot.prompt,
            aspectRatio: project.aspectRatio,
            folderId: project.folderId,
          });
          shot.jobId = job.jobId;
          shot.status = job.status;
          started += 1;
        }
        const saved = await writeProject(ctx, project);
        return { started, project: saved };
      },
    }),
    defineCapability({
      id: "flow.assemble",
      title: "Assemble the edit",
      description:
        "Produce an edit manifest (ordered clips with Drive links) for a project whose shots are rendered.",
      implementation: "google-rest-api",
      scopes: [SCOPES.drive],
      mutating: true,
      input: z.object({ projectId: z.string().min(1) }),
      run: async (ctx, input) => {
        const project = await readProject(ctx, input.projectId);
        const pending = project.shots.filter((shot) => shot.status !== "completed");
        const timeline = project.shots
          .filter((shot) => shot.clip)
          .map((shot, index) => ({ order: index + 1, shotId: shot.id, prompt: shot.prompt, clip: shot.clip }));
        const job = await createJob({
          userId: ctx.userId,
          kind: "flow",
          provider: "nexus",
          model: "flow-assemble",
          prompt: project.title,
          parameters: { projectId: project.projectId },
          status: pending.length === 0 ? "completed" : "running",
          statusDetail:
            pending.length === 0
              ? `${timeline.length} clip(s) in the edit`
              : `${pending.length} shot(s) still rendering`,
          result: { timeline },
        });
        return {
          ...publicJob(job),
          project: { title: project.title, folderId: project.folderId, aspectRatio: project.aspectRatio },
          timeline,
          pendingShots: pending.map((shot) => shot.id),
        };
      },
    }),
    defineCapability({
      id: "flow.list_projects",
      title: "List video projects",
      description: "List Flow-style projects created through Nexus.",
      implementation: "google-rest-api",
      scopes: [SCOPES.drive],
      input: z.object({}),
      run: async (ctx) => {
        const query =
          "mimeType='application/vnd.google-apps.folder' and name contains 'Flow — ' and trashed=false";
        const folders = await ctx.api<{ files?: { id: string; name: string }[] }>(
          `${DRIVE_FILES}?q=${encodeURIComponent(query)}&fields=files(id,name,modifiedTime)&pageSize=50`,
        );
        const recent = await listJobs(ctx.userId, { kind: "flow", limit: 5 });
        return { projects: folders.files ?? [], recentAssemblies: recent.map(publicJob) };
      },
    }),
    defineCapability({
      id: "flow.cancel_assembly",
      title: "Cancel an assembly job",
      description: "Mark a pending assembly job as failed so it stops showing as in progress.",
      implementation: "google-rest-api",
      scopes: [],
      mutating: true,
      input: z.object({ jobId: z.string().min(1) }),
      run: async (ctx, input) => {
        const job = await getJob(ctx.userId, input.jobId);
        if (!job) throw new NexusError("job_not_found", `No job ${input.jobId}.`, 404);
        return publicJob(
          await updateJob(job.id, { status: "failed", errorMessage: "Cancelled by the user" }),
        );
      },
    }),
  ],
});

export default flowAdapter;