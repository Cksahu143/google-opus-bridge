// notebooklm-login-service/server.js
//
// Companion service for capturing a NotebookLM session cookie via a real
// browser login, then handing it to the Supabase bridge for encrypted
// storage in Vault. This does NOT store the cookie itself beyond the single
// request lifecycle below — it captures, forwards, and discards.
//
// UNTESTED — written for review/testing by a human with a real environment
// (Node + notebooklm-py[browser] + playwright installed). See README.md in
// this directory for setup and exact assumptions that need verifying.
//
// Run ONLY on explicit user action ("Connect NotebookLM" button in the
// bridge UI). Never schedule this as a background/cron job.

import express from "express";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const app = express();
app.use(express.json());

// Required env vars — set these in whatever host runs this service
// (NOT in the main bridge's Supabase env; this is a separate deployment):
//   SUPABASE_URL              - the bridge's Supabase project URL
//   SUPABASE_SERVICE_ROLE_KEY - service-role key, used ONLY to call the
//                                internal notebooklm-connect Edge Function
//                                below over HTTPS. Keep this secret; it has
//                                broad DB access. Consider a narrower
//                                dedicated key/RLS policy instead if the
//                                service-role key feels too powerful for
//                                this one call — flagged for review.
//   LOGIN_SERVICE_SHARED_SECRET - a random string both this service and the
//                                Edge Function know, so the Edge Function
//                                can verify the request actually came from
//                                here and not a random caller.
//   PORT                      - defaults to 8787

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  LOGIN_SERVICE_SHARED_SECRET,
  PORT = "8787",
} = process.env;

for (const [name, value] of Object.entries({
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  LOGIN_SERVICE_SHARED_SECRET,
})) {
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
}

/**
 * POST /connect
 * Body: { userId: string, browser?: "chromium" | "msedge" }
 *
 * Launches `notebooklm login` (from notebooklm-py) in a fresh, isolated
 * profile directory. This opens a REAL browser window the calling machine
 * must have a display for (or a virtual display / VNC if headless-with-UI
 * is needed — this is NOT a headless flow, by design: the user must
 * actually see and interact with Google's real login UI).
 *
 * After login succeeds, notebooklm-py writes its cookie/session state to
 * the profile directory. We read that, forward it to the bridge's
 * notebooklm-connect Edge Function for Vault storage, then delete the
 * local copy.
 */
app.post("/connect", async (req, res) => {
  const { userId, browser = "chromium" } = req.body ?? {};
  if (!userId || typeof userId !== "string") {
    return res.status(400).json({ error: "userId is required" });
  }

  const profileDir = await mkdtemp(path.join(tmpdir(), "nblm-login-"));
  const sessionId = randomUUID();

  try {
    // NOTE: exact CLI flags for pointing notebooklm-py at a custom profile
    // directory need to be confirmed against the installed version — check
    // `notebooklm login --help`. --browser and a profile-dir equivalent are
    // referenced in the upstream README; verify the current flag name
    // before relying on this in production.
    const loginArgs = ["login", "--browser", browser];

    await new Promise((resolve, reject) => {
      const child = spawn("notebooklm", loginArgs, {
        env: {
          ...process.env,
          // If notebooklm-py supports pointing its state dir via env var,
          // set it here so this run doesn't clobber/read any other
          // session on the host. CONFIRM the actual env var name against
          // the installed version (see paths.py in the notebooklm-py
          // source) before trusting this in production.
          NOTEBOOKLM_HOME: profileDir,
        },
        stdio: "inherit",
      });
      child.on("exit", (code) => {
        if (code === 0) resolve(undefined);
        else reject(new Error(`notebooklm login exited with code ${code}`));
      });
      child.on("error", reject);
    });

    // CONFIRM exact file name/path notebooklm-py writes its session state
    // to inside its home dir before trusting this glob-free read. Likely
    // something like `<home>/auth/cookies.json` — check
    // src/notebooklm/_cookie_persistence.py in notebooklm-py for the
    // authoritative path.
    const cookiePath = path.join(profileDir, "auth", "cookies.json");
    const cookieJson = await readFile(cookiePath, "utf8");

    const connectResponse = await fetch(
      `${SUPABASE_URL}/functions/v1/notebooklm-connect`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "X-Login-Service-Secret": LOGIN_SERVICE_SHARED_SECRET,
        },
        body: JSON.stringify({
          userId,
          sessionId,
          cookieJson, // the Edge Function is responsible for Vault storage
        }),
      },
    );

    if (!connectResponse.ok) {
      const text = await connectResponse.text();
      throw new Error(
        `notebooklm-connect Edge Function returned ${connectResponse.status}: ${text}`,
      );
    }

    res.json({ ok: true, sessionId });
  } catch (err) {
    console.error("NotebookLM connect failed:", err);
    res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  } finally {
    // Always clean up the local profile dir, success or failure — this is
    // the only copy of the cookie that should ever exist outside Vault,
    // and only for the duration of this request.
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(Number(PORT), () => {
  console.log(`notebooklm-login-service listening on :${PORT}`);
});
