// login-service/server.js
//
// UPDATED for iPad support (see IPAD_LOGIN.md in this directory for why the
// original local-Chromium approach could not work from an iPad).
//
// This version replaces the local `notebooklm login` spawn with a remote
// browser session via Browserbase (https://browserbase.com), which exposes
// a `liveViewUrl` — an embeddable iframe URL the iPad's Safari can load
// directly. The user completes the real Google login by touching/typing
// inside that iframe. Once they finish, we fetch the session's cookies
// from Browserbase's API and forward them to the same notebooklm-connect
// Edge Function as before.
//
// UNTESTED — written for review. Requires a Browserbase account + API key
// (BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID env vars). This is a new
// external dependency — confirm you're OK with that before deploying;
// it's the most reliable way I know to give an iPad a real interactive
// browser without you self-hosting noVNC/CDP streaming infrastructure.

import express from "express";
import { randomUUID } from "node:crypto";

const app = express();
app.use(express.json());

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  LOGIN_SERVICE_SHARED_SECRET,
  BROWSERBASE_API_KEY,
  BROWSERBASE_PROJECT_ID,
  PORT = "8787",
} = process.env;

for (const [name, value] of Object.entries({
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  LOGIN_SERVICE_SHARED_SECRET,
  BROWSERBASE_API_KEY,
  BROWSERBASE_PROJECT_ID,
})) {
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
}

const BROWSERBASE_API = "https://api.browserbase.com/v1";

// In-memory session tracking. For a real deployment this should probably be
// a small DB table instead (so it survives a restart), but for a single-
// instance companion service used interactively, memory is fine to start.
// Keyed by our own sessionId (not Browserbase's), mapped -> { userId,
// browserbaseSessionId, createdAt }.
const pendingSessions = new Map();

/**
 * POST /connect/start
 * Body: { userId: string }
 * Returns: { sessionId, liveViewUrl }
 *
 * Creates a Browserbase session pre-navigated to notebooklm.google.com
 * (which will redirect to Google's real login if not authenticated), and
 * returns a live-view URL. The bridge frontend embeds this URL in an
 * <iframe> on a "Connect NotebookLM" page — this works from an iPad's
 * Safari because it's just an iframe loading a web page, not a native
 * Playwright window.
 */
app.post("/connect/start", async (req, res) => {
  const { userId } = req.body ?? {};
  if (!userId || typeof userId !== "string") {
    return res.status(400).json({ error: "userId is required" });
  }

  try {
    const createRes = await fetch(`${BROWSERBASE_API}/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BB-API-Key": BROWSERBASE_API_KEY,
      },
      body: JSON.stringify({
        projectId: BROWSERBASE_PROJECT_ID,
        // keepAlive so the session survives while the user is actively
        // typing their Google login — default sessions can time out
        // faster. Verify this field name against current Browserbase API
        // docs before relying on it; API surface may have changed.
        keepAlive: true,
      }),
    });

    if (!createRes.ok) {
      const text = await createRes.text();
      throw new Error(`Browserbase session create failed: ${text}`);
    }

    const session = await createRes.json();
    // CONFIRM exact response field names against current Browserbase docs
    // — assumed: session.id, and a separate call/field for the live view
    // URL (Browserbase's "Live View" / debug URL). Some versions of their
    // API return this directly on session create; others require a
    // follow-up GET to /sessions/{id}/debug. Adjust accordingly.
    const browserbaseSessionId = session.id;
    const liveViewUrl =
      session.liveViewUrl ??
      session.debuggerUrl ??
      `${BROWSERBASE_API}/sessions/${browserbaseSessionId}/debug`;

    const sessionId = randomUUID();
    pendingSessions.set(sessionId, {
      userId,
      browserbaseSessionId,
      createdAt: Date.now(),
    });

    res.json({ sessionId, liveViewUrl });
  } catch (err) {
    console.error("Failed to start Browserbase session:", err);
    res.status(500).json({ error: String(err?.message ?? err) });
  }
});

/**
 * POST /connect/complete
 * Body: { sessionId: string }
 *
 * Called by the frontend once the user has finished logging in inside the
 * live-view iframe (e.g. they click an explicit "I'm done" button after
 * seeing NotebookLM's actual notebook list load in the embedded view —
 * don't try to auto-detect completion purely from URL changes inside the
 * iframe, since cross-origin restrictions may prevent reading that from
 * the parent page anyway).
 *
 * Fetches the session's cookies from Browserbase and forwards them to
 * notebooklm-connect for Vault storage, same as the original flow.
 */
app.post("/connect/complete", async (req, res) => {
  const { sessionId } = req.body ?? {};
  const pending = pendingSessions.get(sessionId);
  if (!pending) {
    return res.status(404).json({ error: "unknown or expired sessionId" });
  }

  try {
    // CONFIRM the exact endpoint for retrieving cookies from a Browserbase
    // session — check their current API reference for something like
    // GET /sessions/{id}/downloads or a dedicated cookies endpoint. Their
    // API has changed shape before; this is the piece most likely to need
    // adjustment.
    const cookiesRes = await fetch(
      `${BROWSERBASE_API}/sessions/${pending.browserbaseSessionId}/cookies`,
      { headers: { "X-BB-API-Key": BROWSERBASE_API_KEY } },
    );
    if (!cookiesRes.ok) {
      const text = await cookiesRes.text();
      throw new Error(`Failed to fetch session cookies: ${text}`);
    }
    const cookieJson = await cookiesRes.text();

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
          userId: pending.userId,
          sessionId,
          cookieJson,
        }),
      },
    );

    if (!connectResponse.ok) {
      const text = await connectResponse.text();
      throw new Error(`notebooklm-connect returned ${connectResponse.status}: ${text}`);
    }

    // End the Browserbase session now that we have the cookies — no need
    // to keep it (or its cost) running.
    await fetch(`${BROWSERBASE_API}/sessions/${pending.browserbaseSessionId}`, {
      method: "DELETE",
      headers: { "X-BB-API-Key": BROWSERBASE_API_KEY },
    }).catch((e) => console.warn("Failed to close Browserbase session:", e));

    pendingSessions.delete(sessionId);
    res.json({ ok: true });
  } catch (err) {
    console.error("NotebookLM connect completion failed:", err);
    res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(Number(PORT), () => {
  console.log(`notebooklm-login-service (Browserbase mode) listening on :${PORT}`);
});
