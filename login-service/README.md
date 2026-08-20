# Build & Test Guide — NotebookLM Login (iPad-compatible)

Everything below is **committed but unverified** — I (Claude) wrote it
without being able to run it. Test each piece in order.

## Scope

Goal: make NotebookLM login work when this app is opened on an iPad. No
native app, no App Store, no Xcode — `capacitor.config.ts` is superseded,
see the comment at the top of that file.

## Why a plain login page on iPad doesn't work here

notebooklm-py's login (the reference implementation) launches a real
Chromium browser via Playwright, running on a server. An iPad's Safari
can't run Playwright, and JS on the iPad can't read cookies from a separate
server-side browser process (httpOnly + cross-origin restrictions). So the
login has to happen in a browser the iPad user can actually see and touch.

## The fix: a remote, embeddable browser (Browserbase)

`login-service/server.js` now creates a **Browserbase** session and returns
a `liveViewUrl` — a normal web page showing a real, live, remote Chrome tab.
The frontend (`src/routes/notebooks/connect.tsx`) embeds that URL in a plain
`<iframe>`. The iPad user logs into Google by tapping/typing directly inside
that iframe — to them it looks like any other embedded login widget. Once
done, the service fetches that session's cookies from Browserbase's API and
stores them the same way as before (Supabase Vault).

## Setup steps

### 1. Browserbase account
Sign up at browserbase.com, create a project, get an API key. New external
dependency — there's a cost per browser-minute; confirm their current
pricing before relying on this for production traffic.

### 2. Supabase Vault migration + Edge Function
Same as before — no changes here:
- `supabase/migrations/notebooklm_vault_setup.sql`
- `supabase/functions/notebooklm-connect/index.ts`
Follow the same steps as previously documented: enable the `supabase_vault`
extension, apply the migration, deploy the function, set
`LOGIN_SERVICE_SHARED_SECRET`.

### 3. login-service (now Browserbase-based, no local browser needed)
```
cd login-service
npm install
```
Set env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`LOGIN_SERVICE_SHARED_SECRET`, `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID`.

```
npm start
```

Before wiring up the frontend, test directly:
```
curl -X POST localhost:8787/connect/start \
  -H 'Content-Type: application/json' \
  -d '{"userId":"<test-uuid>"}'
```
Should return `{ sessionId, liveViewUrl }`. Open `liveViewUrl` in any
browser (including an iPad's Safari) — you should see a live, controllable
remote Chrome tab. **CONFIRM the exact response field names against current
Browserbase docs** — I guessed `session.liveViewUrl` / `session.debuggerUrl`
as fallbacks; their API may return this differently now (flagged inline in
the code).

Deploy this service somewhere reachable from your iPad — it cannot stay on
`localhost` for real use. Any small Node host works (Railway, Fly.io,
Render, etc.) since it no longer needs a display or a browser binary
installed locally — Browserbase runs the actual browser remotely.

### 4. Frontend
Set `VITE_NOTEBOOKLM_LOGIN_SERVICE_URL` to wherever login-service is
deployed (build-time env var for this TanStack Start app). Visit
`/notebooks/connect` — on an iPad, in Safari, this should show a "Connect
NotebookLM" button, then the embedded live-view iframe after tapping it.

## Known gaps

- The `/notebooks/connect` page assumes an already-signed-in Supabase user
  (uses `supabase.auth.getUser()`) — it does not itself handle the
  sign-in-to-this-app flow (that's the existing `/auth` page).
- `login-service`'s pending-session tracking is in-memory — if the service
  restarts mid-login, that session is lost. Fine for now; move to a DB
  table if this needs to survive restarts.
- The `/disconnect` path in `notebooklm-connect`'s Edge Function still has
  the same placeholder-auth TODO flagged previously — fix before relying on
  it in production.
- I did not wire the existing `notebook.*` capability handlers to actually
  use the now-stored real cookie (per the mapping table in
  `NOTEBOOKLM_INTEGRATION.md`) — this build gets you through login/storage,
  not through Claude actually using the real account yet.
