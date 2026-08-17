import { defineAdapter } from "@/lib/nexus/types";
import { unavailableCapability } from "@/lib/nexus/unsupported";

/**
 * Google Keep has no public API for personal @gmail.com accounts. The only
 * official Keep API (https://developers.google.com/workspace/keep/api/guides)
 * is Workspace-enterprise-only: it requires a domain admin to grant access
 * via domain-wide delegation or an org-scoped OAuth client, and there is no
 * self-service path for an individual consumer account, so it cannot be
 * wired into a personal-OAuth connector like this one no matter what scopes
 * are requested.
 *
 * The only alternative is an unofficial, reverse-engineered client
 * (gkeepapi) that authenticates with a stolen-looking "master token" instead
 * of real OAuth and openly violates Google's Terms of Service. Nexus does
 * not implement that path — see browser-automation and ToS guidance in the
 * project brief. If Google ever ships a consumer Keep API, swap this stub
 * for a real adapter without touching the router or Claude-facing surface.
 */
export const keepAdapter = defineAdapter({
  service: "keep",
  label: "Google Keep",
  description: "Registered as an honest extension point — no working implementation exists yet.",
  status: "unsupported",
  statusNote:
    "Google Keep has no public API for personal accounts. The official Keep API is Workspace-enterprise-only (admin-granted domain-wide delegation), with no self-service option for a consumer @gmail.com account. The only workaround is an unofficial client that violates Google's ToS, which this connector will not use. Use Drive, Docs, or Tasks for note-taking instead.",
  docsUrl: "https://developers.google.com/workspace/keep/api/guides",
  hidden: true,
  capabilities: [
    unavailableCapability({
      id: "keep.list_notes",
      title: "List notes",
      description: "Would list Google Keep notes, if a consumer API existed.",
      reason:
        "No public Keep API exists for personal Google accounts. Use drive.search or notebook.list for a working substitute.",
    }),
    unavailableCapability({
      id: "keep.create_note",
      title: "Create a note",
      description: "Would create a Google Keep note, if a consumer API existed.",
      reason:
        "No public Keep API exists for personal Google accounts. Use drive.create_text_file or tasks.create_task for a working substitute.",
    }),
  ],
});

export default keepAdapter;
