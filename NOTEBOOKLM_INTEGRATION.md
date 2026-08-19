# NotebookLM Integration — Design & Implementation Plan

Status: DESIGN (not yet implemented). This document defines exactly how
google-opus-bridge will connect a real NotebookLM account, replacing the
current `notebook.*` capabilities (which are a separate, connector-managed
reimplementation — see README's own NotebookLM section — not the user's
actual NotebookLM account).

## Reference implementation

Built on [teng-lin/notebooklm-py](https://github.com/teng-lin/notebooklm-py)
(MIT, ~18.8k stars, active). This is an **unofficial** client using
undocumented NotebookLM RPC endpoints — not a public Google API. Google can
change these endpoints without notice; this integration must be clearly
labeled "unofficial" per the project's own AGENTS.md principle: do not
invent APIs, and isolate unofficial integrations behind an adapter.

## How notebooklm-py authenticates

- `notebooklm login` launches a real Chromium browser via Playwright.
- The user signs into their Google account normally in that browser window
  (their real login UI — no password is ever seen by the library).
- After login, the library extracts the NotebookLM session **cookies** and
  persists them locally (see its `_cookie_persistence.py` / `_secrets.py`).
- All subsequent API calls replay those cookies against NotebookLM's
  internal RPC endpoints (see `_rpc_executor.py`).
- No OAuth flow, no API key — the cookie IS the credential. Treat it with
  the same sensitivity as a live session token, because that's what it is.

## Why this can't run directly inside a Supabase Edge Function

Edge Functions (Deno runtime) have no headless-Chromium binary available and
have execution time limits unsuited to an interactive OAuth-style browser
login. The login step specifically needs a real browser and real user
interaction (the person must actually type their Google credentials into
Google's own UI — we never see or store the password).

## Proposed architecture

```
User (browser)
   ↓ opens a login page served by the bridge
Bridge frontend
   ↓ redirects to / embeds a Playwright-driven login flow
Small companion service (Node/Python, NOT the Edge Function)
   ↓ runs Playwright + notebooklm-py's login logic
   ↓ on success, extracts session cookies
Bridge backend (Supabase)
   ↓ receives cookies over an authenticated internal call
   ↓ encrypts and stores them in Supabase Vault (pgsodium), scoped per-user
Edge Functions (notebook.* capability handlers)
   ↓ on each call, decrypt cookie from Vault, replay against
     NotebookLM RPC endpoints via the same logic as notebooklm-py
```

The companion service is the one piece that cannot live in an Edge Function.
It can be a small, short-lived container (Railway/Fly.io/Render, or a
self-hosted box) that:
1. Only runs during an explicit "Connect NotebookLM" action the user
   initiates — never runs unattended.
2. Immediately hands the captured cookie to the Supabase backend over TLS
   and discards its own copy.
3. Never logs the cookie value.

## Storage: Supabase Vault, not a file or plain env var

- Use `supabase.vault.create_secret()` (pgsodium-backed, encrypted at rest)
  keyed per connected Google account.
- Never write the cookie to a repo file, a Storage bucket, or a plaintext
  column — Vault only.
- Store alongside it: capture timestamp, and a human-readable "connected as
  [email]" label (not the email as the secret key itself).

## Revocation / re-authentication

- Cookies expire (typical Google session cookie lifetime, refreshed by
  activity but not indefinite). Detect expiry from a 401/redirect-to-login
  response from the RPC endpoints and surface "NotebookLM connection
  expired — reconnect" rather than failing silently.
- Add a "Disconnect NotebookLM" action that deletes the Vault secret
  immediately — this is the user's kill switch.
- Document in-app (not just in this file) what is stored, where, and how to
  revoke it, per the README's existing NOTEBOOKLM_AUTHENTICATION principle.

## Capability mapping (replaces the current mock `notebook.*` set)

| Bridge capability | notebooklm-py equivalent |
|---|---|
| `notebook.list` | `client.notebooks.list()` |
| `notebook.create` | `client.notebooks.create()` |
| `notebook.get` | `client.notebooks.get()` |
| `notebook.add_source` | `client.sources.add()` |
| `notebook.ask` | `client.chat.ask()` (real grounded chat, not our Gemini reimplementation) |
| `notebook.summarize` | `client.notebooks.summarize()` / studio artifact generation |

Once connected, notebooks created through the bridge are **real NotebookLM
notebooks** — they will appear at notebooklm.google.com under the connected
account, unlike the current `notebook.*` implementation whose notebooks only
exist inside this bridge's own database.

## Migration note for existing "Nexus" notebooks

Notebooks created via the current connector-managed `notebook.*` capability
(stored only in this bridge's own database, e.g. the "Memory" notebook used
by `memory.remember`/`memory.recall`) are **not** NotebookLM notebooks and
cannot be transparently moved into a real NotebookLM account — there is no
existing-notebook "import my own text" path except creating a new real
notebook and re-adding those sources as text sources via
`notebook.add_source` → `client.sources.add()`. This should be an explicit,
user-initiated one-time migration step once real NotebookLM auth exists, not
an automatic silent move.

## Open implementation work (not done in this commit)

1. Stand up the companion login service (choose hosting).
2. Wire Supabase Vault read/write in the Edge Functions.
3. Replace `notebook.*` handlers to call notebooklm-py's RPC logic (or run
   notebooklm-py's own MCP server as a subprocess the companion service
   proxies to, per its 0.8.0 MCP server mode — simpler than reimplementing
   the RPC layer from scratch).
4. Add the "Connect / Disconnect NotebookLM" UI flow.
5. Add expiry detection + reconnect prompt.
6. Update PROVIDERS.md / claude-google doctor output to show real
   "NotebookLM (connected as x@gmail.com)" status instead of "partial".
