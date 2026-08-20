# Build & Test Guide — NotebookLM Login (No Cost, No Credit Card, iPad-compatible)

Everything below is **committed but unverified** — written for review, not
run by me. Test each piece in order. $0 total cost, and no signup anywhere
in this path asks for a payment method — the two services involved
(Supabase, Cloudflare) only ask for an email/username on their free tiers.

## Scope

Make NotebookLM login work when this app is opened on an iPad, at zero
cost, with no credit card required anywhere in the stack.
`capacitor.config.ts`, the Browserbase version, and the Oracle-Cloud-based
plan are all superseded — Oracle requires a card for identity verification
even on its free tier, which doesn't fit what you asked for.

## How it works

1. `login-service` runs in a Docker container (`Dockerfile` in this dir)
   containing a virtual display (Xvfb), a real Chromium browser, and
   noVNC (browser-based VNC viewer) — all free, open-source, self-hosted.
2. It runs on **hardware you already own** — no cloud account, no signup,
   nothing to create an account for at all. This is the only genuinely
   zero-signup option: any cloud provider giving you a public server
   requires *some* form of identity verification (that's industry-wide,
   not specific to any one provider).
3. To reach it from an iPad when you're NOT on the same home WiFi, use
   **Cloudflare Tunnel** (`cloudflared`) — free, and its signup only asks
   for an email address, no card. It exposes your local container to the
   internet via a Cloudflare-generated URL, without opening any ports on
   your home router or revealing your home IP address.
4. When the user clicks "Connect NotebookLM" (`/notebooks/connect`), the
   service launches Chromium on the virtual display, navigated to
   notebooklm.google.com, returns a `liveViewUrl` (noVNC's page).
5. The frontend embeds that in an `<iframe>`. The user logs into Google by
   tapping/typing inside it, same as any embedded widget.
6. On "I'm done," the service reads cookies from the running Chromium via
   CDP, forwards them to `notebooklm-connect` (Supabase Edge Function,
   free tier, email-only signup) for encrypted storage in Supabase Vault.
7. Xvfb/Chromium/noVNC processes are torn down.

## KNOWN LIMITATION: one session at a time
(unchanged — single fixed display/VNC port; second concurrent login gets
a 409; true multi-tenancy is a separate follow-up.)

## Setup steps

### 1. A machine you already own
Any computer that can stay on while you're testing — a laptop, desktop,
spare Raspberry Pi. No account creation of any kind for this step. Install
Docker on it (docker.com/get-started — free, no signup required to
download/install Docker Desktop or Docker Engine).

### 2. Build and run the container
```
cd login-service
docker build -t nblm-login-service .
docker run -d \
  -p 8787:8787 -p 6080:6080 \
  -e SUPABASE_URL=https://<your-project>.supabase.co \
  -e SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
  -e LOGIN_SERVICE_SHARED_SECRET=<random-string, matches Edge Function secret> \
  -e PUBLIC_HOST=localhost \
  nblm-login-service
```
If you'll only ever use this from the iPad while on the same home WiFi as
this machine, set `PUBLIC_HOST` to this machine's local network IP (e.g.
`192.168.1.x`, found via `ipconfig`/`ifconfig`) instead of `localhost`,
and skip step 3 entirely — you're done, zero signups needed at all.

### 3. (Only if you need iPad access away from home WiFi) Cloudflare Tunnel
1. Sign up at dash.cloudflare.com — email + password only, no card, on
   the free plan.
2. Install `cloudflared` (free, open source —
   developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads).
3. Quick option, no domain needed:
   ```
   cloudflared tunnel --url http://localhost:8787
   ```
   This prints a random `https://<random>.trycloudflare.com` URL that
   proxies to your container — use that as `PUBLIC_HOST`'s value (without
   the port, since Cloudflare terminates HTTPS on 443 and forwards to your
   local port). You'd need a second tunnel for port 6080 (noVNC) the same
   way, or point both at a single reverse-proxy port if you set one up
   (see Known gaps — not yet built here).
4. Quick tunnels are temporary (rotate on restart). For a stable URL long
   term, Cloudflare's free plan also supports named/persistent tunnels
   tied to a domain — still no card, but does need you to add a domain to
   Cloudflare (you can get a free subdomain via services like *.eu.org or
   *.js.org if you don't want to buy one, or just accept the rotating
   trycloudflare.com URL for personal use).

### 4. Verify
```
curl -X POST http://<PUBLIC_HOST-or-tunnel-url>/connect/start \
  -H 'Content-Type: application/json' \
  -d '{"userId":"<test-uuid>"}'
```
Should return `{ sessionId, liveViewUrl }`. Open it in a browser first —
you should see a live Chromium tab on notebooklm.google.com's login
redirect. **Verify and fix if wrong** (flagged inline in
`server.js`/`Dockerfile`): the noVNC static file path
(`--web=/usr/share/novnc`) and viewer filename (`vnc_lite.html`) can differ
by package version — check with `docker exec <container> dpkg -L novnc`.

### 5. Supabase side (free tier, email-only signup — unchanged)
- Apply `supabase/migrations/notebooklm_vault_setup.sql`
- Deploy `supabase/functions/notebooklm-connect`
- Set its `LOGIN_SERVICE_SHARED_SECRET` to match step 2

### 6. Frontend
Set `VITE_NOTEBOOKLM_LOGIN_SERVICE_URL` to `http://<local-ip>:8787` (home
WiFi) or your Cloudflare Tunnel URL. Visit `/notebooks/connect` on the
iPad in Safari.

## Tradeoffs of the no-card path (be aware of these)

- **Home WiFi only, no tunnel:** simplest, truly zero signup, but only
  works when the iPad and the host machine are on the same network.
- **With Cloudflare Tunnel:** works from anywhere, still no card, but adds
  a dependency on your host machine staying powered on and connected
  whenever you want to use this — there's no cloud always-on guarantee
  here, unlike a hosted VM.

## Known gaps

- No server-side timeout on an abandoned session.
- No HTTPS on the direct local-IP path (fine on trusted home WiFi; the
  Cloudflare Tunnel path gets HTTPS for free automatically).
- The `/disconnect` path in `notebooklm-connect` still has the
  placeholder-auth TODO flagged previously.
- The `notebook.*` capability handlers still don't use the stored cookie
  yet — see `NOTEBOOKLM_INTEGRATION.md`.
