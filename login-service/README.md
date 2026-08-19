# Build & Test Guide — NotebookLM Integration + iPad App

Everything below is **committed but unverified** — I (Claude) wrote it without
being able to run it. Test each piece in order; each step assumes the
previous one works.

## 1. Supabase Vault migration

```
supabase/migrations/notebooklm_vault_setup.sql
```

1. Confirm the `supabase_vault` extension is enabled on this project
   (Dashboard → Database → Extensions → search "vault"). Enable it there if
   not — hosted Supabase projects sometimes require this via dashboard
   rather than a plain `create extension` in a migration.
2. Apply the migration (`supabase db push` or paste into the SQL editor).
3. Sanity check: `select * from vault.secrets limit 1;` should not error.
4. Verify the RLS policy on `notebooklm_connections` matches how the rest
   of this app identifies "the current user" — I assumed `auth.uid()`,
   confirm that's consistent with existing tables in `supabase/`.

## 2. `notebooklm-connect` Edge Function

```
supabase/functions/notebooklm-connect/index.ts
```

1. Deploy: `supabase functions deploy notebooklm-connect`
2. Set secrets it needs:
   ```
   supabase secrets set LOGIN_SERVICE_SHARED_SECRET=<generate a random string>
   ```
   (`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are usually auto-available
   inside Edge Functions — confirm they don't need to be set manually on
   this project.)
3. Test the `/disconnect` path's auth — I left a TODO in the code: it
   currently trusts a client-supplied `userId` with no JWT check. Fix that
   before this goes anywhere near production; it's flagged in a comment.

## 3. `login-service` companion

```
login-service/
```

This is the riskiest untested piece — it shells out to the `notebooklm` CLI
from notebooklm-py.

1. `cd login-service && npm run setup` — creates a Python venv, installs
   `notebooklm-py[browser]`, installs the Playwright Chromium binary.
2. **Before running for real**, open a terminal and run `notebooklm login
   --help` yourself to confirm:
   - The exact flag for pointing at a custom home/profile directory (I
     guessed `NOTEBOOKLM_HOME` as an env var — verify against
     `src/notebooklm/paths.py` in the notebooklm-py source, linked from
     `NOTEBOOKLM_INTEGRATION.md`).
   - The exact file path it writes session state to (I guessed
     `<home>/auth/cookies.json` — verify against
     `src/notebooklm/_cookie_persistence.py`).
   Update `server.js` if either guess is wrong — both are marked with
   inline `CONFIRM` comments.
3. Set env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `LOGIN_SERVICE_SHARED_SECRET` (same value as step 2.2).
4. `npm start`, then `curl -X POST localhost:8787/connect -H 'Content-Type:
   application/json' -d '{"userId":"<your-test-uuid>"}'` — this should pop
   open a real Chromium window for you to log into Google. Confirm the
   secret lands in Vault: `select name, description from vault.secrets;`
   (never `select decrypted_secret` unless you specifically need to —
   avoid printing the raw cookie anywhere).
5. Decide where this actually runs long-term. It cannot be a Supabase Edge
   Function (no browser). A small always-on box, or something you run
   manually per-connect, both work — your call based on how often
   reconnects are needed.

## 4. iPad app via Capacitor

```
capacitor.config.ts
```

1. `npm install @capacitor/core @capacitor/cli @capacitor/ios`
2. Confirm `capacitor.config.ts`'s `server.url` is your real production
   domain (currently set to `https://google-opus-bridge.lovable.app` —
   verify that's actually where this deploys).
3. `npx cap add ios`
4. `npx cap open ios` — opens Xcode.
5. In Xcode: select your Apple ID / team under Signing & Capabilities,
   set Deployment Target device to iPad (or Universal), plug in the iPad
   or use a Simulator, hit Run.
6. This is a **remote-content wrapper**, not an offline app — the iPad
   needs network access to load the live site each time, since this app
   is server-rendered (TanStack Start/Nitro) rather than a static SPA. If
   you want offline support later, that's a separate, larger project
   (static export or a dedicated mobile-optimized build).

## Known gaps / things I did not attempt

- No UI was added for "Connect NotebookLM" / "Disconnect" buttons in
  `src/` — only the backend pieces above.
- The `notebooklm-connect` disconnect endpoint's auth is a placeholder
  (see TODO in the code) — fix before relying on it.
- I did not replace the existing `notebook.*` capability handlers to call
  real NotebookLM — this build only gets you as far as *storing* a real
  session cookie. Wiring the actual `notebook.list` / `notebook.create` /
  etc. handlers to use it (per the mapping table in
  `NOTEBOOKLM_INTEGRATION.md`) is still open.
