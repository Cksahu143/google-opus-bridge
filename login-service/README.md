# Build & Test Guide — NotebookLM Login (Free, Self-Hosted, iPad-compatible)

Everything below is **committed but unverified** — written for review, not
run by me. Test each piece in order. Zero third-party API costs — the only
cost is whatever you pay for a small server to run the Docker container on
(a $4–$6/mo VPS is plenty for single-session use).

## Scope

Make NotebookLM login work when this app is opened on an iPad, for free,
self-hosted, no native app. `capacitor.config.ts` and the earlier
Browserbase-based version are both superseded — see comments in
`capacitor.config.ts` and git history if you want to compare.

## How it works

1. `login-service` runs in a Docker container (see `Dockerfile`) containing
   a virtual display (Xvfb), a real Chromium browser, and noVNC (a
   browser-based VNC viewer).
2. When the user clicks "Connect NotebookLM" (`/notebooks/connect` in the
   frontend), the service launches Chromium on the virtual display,
   navigated to notebooklm.google.com, and returns a `liveViewUrl` —
   noVNC's own webpage that shows and lets you control that Chromium tab.
3. The frontend embeds that URL in a plain `<iframe>`. On an iPad, this
   works exactly like any embedded widget — tap and type normally.
4. Once the user finishes logging into Google inside that iframe and taps
   "I'm done," the service connects to the already-running Chromium over
   CDP (Chrome DevTools Protocol) and reads its cookies — no second
   browser, just reading state from the one the user was just using.
5. Those cookies get forwarded to `notebooklm-connect` (Supabase Edge
   Function) and stored encrypted in Supabase Vault, same as before.
6. The virtual display, Chromium, and noVNC processes are torn down.

## KNOWN LIMITATION: one session at a time

This MVP uses a single fixed virtual display/VNC port. If a second person
tries to connect while someone else is mid-login, they get a 409 error.
For personal/small-scale use this is likely fine. Making it properly
multi-tenant means dynamically allocating a display number + VNC port +
websockify port per session (and a reverse proxy in front to route each
user to their own port) — real additional work, not attempted here.

## Setup steps

### 1. A server to run the container on
Any small Linux VPS with Docker (Hetzner, DigitalOcean, a spare machine at
home with port forwarding, etc.). Needs two ports reachable from the
internet (or at least from wherever the iPad is): 8787 (the API) and 6080
(noVNC).

### 2. Build and run
```
cd login-service
docker build -t nblm-login-service .
docker run -d \
  -p 8787:8787 -p 6080:6080 \
  -e SUPABASE_URL=https://<your-project>.supabase.co \
  -e SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
  -e LOGIN_SERVICE_SHARED_SECRET=<random-string, matches Edge Function secret> \
  -e PUBLIC_HOST=<your-server-public-ip-or-domain> \
  nblm-login-service
```
`PUBLIC_HOST` must be reachable from the iPad — not `localhost`.

### 3. Verify before wiring up the frontend
```
curl -X POST http://<PUBLIC_HOST>:8787/connect/start \
  -H 'Content-Type: application/json' \
  -d '{"userId":"<test-uuid>"}'
```
Should return `{ sessionId, liveViewUrl }`. Open `liveViewUrl` in a normal
browser first (before trying iPad) — you should see a live Chromium tab
showing notebooklm.google.com's login redirect. **Two things to verify and
fix if wrong, both flagged inline in `server.js` and `Dockerfile`:**
- The noVNC static file path (`--web=/usr/share/novnc`) — confirm with
  `docker exec <container> dpkg -L novnc | grep vnc_lite.html` and adjust
  if the installed path differs.
- The viewer filename (`vnc_lite.html`) — some noVNC versions differ; check
  what's actually in that directory if the URL 404s.

### 4. Supabase side (unchanged from before)
- Apply `supabase/migrations/notebooklm_vault_setup.sql`
- Deploy `supabase/functions/notebooklm-connect`
- Set its `LOGIN_SERVICE_SHARED_SECRET` to match step 2

### 5. Frontend
Set `VITE_NOTEBOOKLM_LOGIN_SERVICE_URL=http://<PUBLIC_HOST>:8787` (build-time
env var). Visit `/notebooks/connect` on the iPad in Safari.

## Known gaps

- No server-side timeout on an abandoned session — if a user starts a
  login and closes the tab without it triggering the unmount-cleanup
  fetch (flaky networks, force-quitting Safari, etc.), the single-session
  slot can get stuck occupied. Add a timeout (e.g. auto-cancel after 10
  minutes) as a follow-up.
- No HTTPS/TLS termination is set up — running this over plain HTTP means
  the Google login page is loaded inside an iframe over an unencrypted
  connection to your VPS, which is a real problem for anything beyond
  personal testing. Put this behind a reverse proxy (e.g. Caddy or nginx
  with Let's Encrypt) before using it for anything you care about.
- The `/disconnect` path in `notebooklm-connect` still has the placeholder-
  auth TODO flagged previously — fix before relying on it.
- The `notebook.*` capability handlers still don't use the now-stored real
  cookie — this gets you through login + secure storage, not to Claude
  actually managing the real account yet (see the mapping table in
  `NOTEBOOKLM_INTEGRATION.md` for what that would take).
