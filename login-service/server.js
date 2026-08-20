// login-service/server.js
//
// FREE / SELF-HOSTED version — no Browserbase, no third-party API costs.
// Runs a real Chrome instance in a virtual display (Xvfb) inside this
// service's own container, exposes it via noVNC (browser-based VNC client)
// so an iPad's Safari can view and interact with it through a plain
// <iframe>, then extracts the resulting login cookies via Chrome DevTools
// Protocol (CDP) — no Playwright browser download needed, playwright-core
// can attach to an already-running Chrome via connectOverCDP.
//
// UNTESTED — written for review. Requires Docker (see Dockerfile in this
// directory) and a host to run the container on (a small VPS, a spare
// machine, etc. — this cannot run inside a Supabase Edge Function).
//
// KNOWN LIMITATION: this MVP supports ONE login session at a time (single
// Xvfb display :99, single Chrome instance, single VNC/websockify port).
// If two people try to connect NotebookLM simultaneously, the second request
// will fail with "a login is already in progress" until the first finishes
// or times out. Making this properly multi-tenant (dynamic displays/ports
// per session) is real additional work — flagged as a follow-up, not
// attempted here since it meaningfully increases complexity and I can't
// test either version.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import express from "express";
import { chromium } from "playwright-core";

const app = express();
app.use(express.json());

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  LOGIN_SERVICE_SHARED_SECRET,
  PORT = "8787",
  DISPLAY_NUM = "99",
  CDP_PORT = "9222",
  VNC_PORT = "5900",
  NOVNC_PORT = "6080",
  // PUBLIC_HOST must be set to whatever hostname/IP the iPad will actually
  // reach this container on (e.g. your VPS's public IP or domain). It
  // cannot be "localhost" once deployed — that would only work from the
  // container's own machine.
  PUBLIC_HOST,
} = process.env;

for (const [name, value] of Object.entries({
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  LOGIN_SERVICE_SHARED_SECRET,
  PUBLIC_HOST,
})) {
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
}

const DISPLAY = `:${DISPLAY_NUM}`;

/** @type {{ sessionId: string, userId: string, procs: import('node:child_process').ChildProcess[] } | null} */
let activeSession = null;

function spawnTracked(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { stdio: "inherit", ...opts });
  child.on("error", (err) => console.error(`${cmd} failed to start:`, err));
  return child;
}

async function killAll(procs) {
  for (const p of procs) {
    try {
      p.kill("SIGTERM");
    } catch {
      // already dead, ignore
    }
  }
}

/**
 * POST /connect/start
 * Body: { userId: string }
 * Returns: { sessionId, liveViewUrl }
 *
 * Boots: Xvfb (virtual display) -> Chrome on that display with CDP enabled,
 * navigated to notebooklm.google.com -> x11vnc (exposes the display over
 * VNC) -> websockify (bridges VNC to a WebSocket + serves the noVNC static
 * client). Returns a URL to noVNC's built-in lightweight viewer page,
 * which is a normal webpage embeddable in an <iframe> — this is what makes
 * it work on an iPad.
 */
app.post("/connect/start", async (req, res) => {
  const { userId } = req.body ?? {};
  if (!userId || typeof userId !== "string") {
    return res.status(400).json({ error: "userId is required" });
  }
  if (activeSession) {
    return res.status(409).json({
      error: "a login is already in progress— try again once it finishes (single-session MVP limitation)",
    });
  }

  const sessionId = randomUUID();
  const procs = [];

  try {
    // 1. Virtual display
    procs.push(
      spawnTracked("Xvfb", [DISPLAY, "-screen", "0", "1280x800x24", "-nolisten", "tcp"]),
    );
    await new Promise((r) => setTimeout(r, 1000)); // let Xvfb come up

    // 2. Chrome, on that display, with remote debugging enabled so we can
    //    attach via CDP later to read cookies without disturbing the
    //    visible session.
    procs.push(
      spawnTracked(
        "chromium",
        [
          `--remote-debugging-port=${CDP_PORT}`,
          "--remote-debugging-address=127.0.0.1",
          "--no-first-run",
          "--no-default-browser-check",
          "--start-maximized",
          "--user-data-dir=/tmp/nblm-chrome-profile",
          "https://notebooklm.google.com",
        ],
        { env: { ...process.env, DISPLAY } },
      ),
    );
    await new Promise((r) => setTimeout(r, 2000)); // let Chrome start + CDP come up

    // 3. VNC server exposing the display
    procs.push(
      spawnTracked("x11vnc", [
        "-display", DISPLAY,
        "-rfbport", VNC_PORT,
        "-forever",
        "-shared",
        "-nopw",
        "-quiet",
      ]),
    );
    await new Promise((r) => setTimeout(r, 500));

    // 4. websockify bridges VNC->WebSocket AND serves noVNC's static files
    //    (assumed installed at /usr/share/novnc by the Dockerfile in this
    //    directory — CONFIRM that path matches the actual noVNC package
    //    install location on whatever base image is used).
    procs.push(
      spawnTracked("websockify", [
        "--web=/usr/share/novnc",
        NOVNC_PORT,
        `localhost:${VNC_PORT}`,
      ]),
    );
    await new Promise((r) => setTimeout(r, 500));

    activeSession = { sessionId, userId, procs };

    // vnc_lite.html is noVNC's minimal single-page viewer, good for
    // embedding. autoconnect + resize=scale keep this usable inside a
    // small iframe on an iPad screen. CONFIRM this file name matches the
    // installed noVNC version — some versions ship it as vnc.html with
    // different query params instead.
    const liveViewUrl = `http://${PUBLIC_HOST}:${NOVNC_PORT}/vnc_lite.html?autoconnect=true&resize=scale&reconnect=true`;

    res.json({ sessionId, liveViewUrl });
  } catch (err) {
    console.error("Failed to start login session:", err);
    await killAll(procs);
    activeSession = null;
    res.status(500).json({ error: String(err?.message ?? err) });
  }
});

/**
 * POST /connect/complete
 * Body: { sessionId: string }
 *
 * Attaches to the already-running Chrome via CDP (chromium.connectOverCDP),
 * reads the current cookies from its browser context, forwards them to
 * notebooklm-connect for Vault storage, then tears down Xvfb/Chrome/
 * x11vnc/websockify.
 */
app.post("/connect/complete", async (req, res) => {
  const { sessionId } = req.body ?? {};
  if (!activeSession || activeSession.sessionId !== sessionId) {
    return res.status(404).json({ error: "unknown or already-completed sessionId" });
  }

  const { userId, procs } = activeSession;

  try {
    // Attach to the running Chrome instance over CDP — this does NOT open
    // a second visible window, it connects to the existing one the user
    // was just looking at.
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
    const context = browser.contexts()[0];
    if (!context) throw new Error("No browser context found via CDP");
    const cookies = await context.cookies();
    await browser.close(); // closes the CDP connection, not the actual Chrome

    const cookieJson = JSON.stringify(cookies);

    const connectResponse = await fetch(
      `${SUPABASE_URL}/functions/v1/notebooklm-connect`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "X-Login-Service-Secret": LOGIN_SERVICE_SHARED_SECRET,
        },
        body: JSON.stringify({ userId, sessionId, cookieJson }),
      },
    );

    if (!connectResponse.ok) {
      const text = await connectResponse.text();
      throw new Error(`notebooklm-connect returned ${connectResponse.status}: ${text}`);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("NotebookLM connect completion failed:", err);
    res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  } finally {
    await killAll(procs);
    await rm("/tmp/nblm-chrome-profile", { recursive: true, force: true }).catch(() => {});
    activeSession = null;
  }
});

/**
 * POST /connect/cancel
 * Body: { sessionId: string }
 * Lets the frontend clean up an abandoned session (e.g. user navigated
 * away) without waiting for a timeout, freeing the single-session slot.
 */
app.post("/connect/cancel", async (req, res) => {
  const { sessionId } = req.body ?? {};
  if (activeSession?.sessionId === sessionId) {
    await killAll(activeSession.procs);
    await rm("/tmp/nblm-chrome-profile", { recursive: true, force: true }).catch(() => {});
    activeSession = null;
  }
  res.json({ ok: true });
});

app.get("/health", (_req, res) => res.json({ ok: true, activeSession: activeSession?.sessionId ?? null }));

app.listen(Number(PORT), () => {
  console.log(`notebooklm-login-service (self-hosted noVNC mode) listening on :${PORT}`);
});
