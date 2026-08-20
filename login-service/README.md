# Build & Test Guide — NotebookLM Login (Completely Free, Self-Hosted, iPad-compatible)

Everything below is **committed but unverified** — written for review, not
run by me. Test each piece in order. $0 total cost: no third-party browser
API (Browserbase removed), and hosting uses Oracle Cloud's Always Free tier
instead of a paid VPS (see step 1).

## Scope

Make NotebookLM login work when this app is opened on an iPad, at zero
cost, self-hosted, no native app. `capacitor.config.ts` and the earlier
Browserbase-based version are both superseded — see comments in
`capacitor.config.ts` and git history if you want to compare.

## How it works

1. `login-service` runs in a Docker container (see `Dockerfile`) containing
   a virtual display (Xvfb), a real Chromium browser, and noVNC (a
   browser-based VNC viewer) — all free, open-source software.
2. When the user clicks "Connect NotebookLM" (`/notebooks/connect` in the
   frontend), the service launches Chromium on the virtual display,
   navigated to notebooklm.google.com, and returns a `liveViewUrl` —
   noVNC's own webpage that shows and lets you control that Chromium tab.
3. The frontend embeds that URL in a plain `<iframe>`. On an iPad, this
   works exactly like any embedded widget — tap and type normally.
4. Once the user finishes logging into Google inside that iframe and taps
   "I'm done," the service connects to the already-running Chromium over
   CDP (Chrome DevTools Protocol) and reads its cookies.
5. Those cookies get forwarded to `notebooklm-connect` (Supabase Edge
   Function, also free tier) and stored encrypted in Supabase Vault.
6. The virtual display, Chromium, and noVNC processes are torn down.

## KNOWN LIMITATION: one session at a time

Single fixed virtual display/VNC port. A second concurrent login attempt
gets a 409. Fine for personal use; true multi-tenancy is a bigger follow-up
(dynamic display/port allocation + a routing proxy) not attempted here.

## Setup steps

### 1. Free hosting: Oracle Cloud "Always Free" tier
This is the piece that makes the whole thing $0 rather than ~$5/mo. Oracle
Cloud's Always Free tier includes a small compute instance (e.g. an ARM
Ampere shape, currently up to 4 OCPU / 24GB RAM in the free allotment,
or an AMD E2.1.Micro instance) that stays free indefinitely — not a trial.

**I cannot provision this for you** — no cloud-infrastructure tool is
available to me. You'll need to:
1. Sign up at oracle.com/cloud/free (a credit card is required for identity
   verification, but the Always Free resources are not billed to it as
   long as you stay within the free-tier limits — confirm current terms
   on Oracle's site since free-tier offerings do change over time).
2. Create an Always Free compute instance (Ubuntu is a simple default
   image choice), open ports 8787 and 6080 in its network security
   list/security group.
3. SSH in, install Docker (`curl -fsSL https://get.docker.com | sh` works
   on most images), then continue with step 2 below.

Other genuinely-free-forever alternatives if Oracle's terms or
availability don't work for you: a spare always-on machine you already own
(e.g. an old laptop or Raspberry Pi) with port forwarding on your home
router — zero cloud cost, but ties this to your home internet uptime and
exposes your home IP. Your call which tradeoff you'd rather make; I can't
tell you which is better without knowing your setup.

### 2. Build and run
```
cd login-service
docker build -t nblm-login-service .
docker run -d \
  -p 8787:8787 -p 6080:6080 \
  -e SUPABASE_URL=https://<your-project>.supabase.co \
  -e SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
  -e LOGIN_SERVICE_SHARED_SECRET=<random-string, matches Edge Function secret> \
  -e PUBLIC_HOST=<your-oracle-instance-public-ip-or-domain> \
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
browser first — you should see a live Chromium tab showing
notebooklm.google.com's login redirect. **Verify and fix if wrong, both
flagged inline in `server.js`/`Dockerfile`:**
- The noVNC static file path (`--web=/usr/share/novnc`) — confirm with
  `docker exec <container> dpkg -L novnc | grep vnc_lite.html`.
- The viewer filename (`vnc_lite.html`) — some noVNC versions differ.

### 4. Supabase side (free tier — unchanged from before)
- Apply `supabase/migrations/notebooklm_vault_setup.sql`
- Deploy `supabase/functions/notebooklm-connect`
- Set its `LOGIN_SERVICE_SHARED_SECRET` to match step 2

### 5. Frontend
Set `VITE_NOTEBOOKLM_LOGIN_SERVICE_URL=http://<PUBLIC_HOST>:8787` (build-time
env var). Visit `/notebooks/connect` on the iPad in Safari.

## Known gaps

- No server-side timeout on an abandoned session — could leave the
  single-session slot stuck occupied. Add a timeout as a follow-up.
- No HTTPS/TLS termination — the Google login page currently loads inside
  the iframe over plain HTTP to your free instance, which is a real
  problem for anything beyond personal testing. **This still costs
  nothing to fix**: Caddy (free, open-source) auto-provisions free Let's
  Encrypt certificates with a couple lines of config — put it in front of
  ports 8787/6080 as a reverse proxy before using this for real. Not yet
  added to the Dockerfile/compose — flagged as the next concrete step.
- The `/disconnect` path in `notebooklm-connect` still has the placeholder-
  auth TODO flagged previously — fix before relying on it.
- The `notebook.*` capability handlers still don't use the now-stored real
  cookie — see `NOTEBOOKLM_INTEGRATION.md` for that mapping.
