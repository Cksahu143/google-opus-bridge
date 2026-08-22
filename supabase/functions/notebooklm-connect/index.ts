// supabase/functions/notebooklm-connect/index.ts
//
// Receives a captured NotebookLM session cookie from the login-service
// companion (see /login-service in repo root) and stores it encrypted in
// Supabase Vault, scoped to the calling user. Also exposes a disconnect
// path to delete the secret (the user's kill switch).
//
// UNTESTED — written for review/deployment by a human with a real Supabase
// project. Verify Vault is enabled on the project (Dashboard > Database >
// Vault, or `select * from vault.secrets limit 1;` to check the extension
// is active) before deploying.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOGIN_SERVICE_SHARED_SECRET = Deno.env.get("LOGIN_SERVICE_SHARED_SECRET")!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !LOGIN_SERVICE_SHARED_SECRET) {
  console.error(
    "Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LOGIN_SERVICE_SHARED_SECRET",
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Vault secret naming: one secret per connected user, named deterministically
// so we can look it up again without a separate mapping table. Adjust if the
// bridge's user-id scheme differs from a plain UUID.
function vaultSecretName(userId: string): string {
  return `notebooklm_session_${userId}`;
}

serve(async (req) => {
  const url = new URL(req.url);
  // Supabase Edge Functions receive the URL with the function's own name as
  // a path prefix (e.g. /notebooklm-connect/status), not a bare path — strip
  // it so routing below works the same locally and when deployed.
  const path = url.pathname.replace(/^\/notebooklm-connect/, "") || "/";

  // --- POST /  (called only by login-service, never by the frontend) ---
  if (req.method === "POST" && path === "/") {
    const incomingSecret = req.headers.get("X-Login-Service-Secret");
    if (incomingSecret !== LOGIN_SERVICE_SHARED_SECRET) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
      });
    }

    const { userId, sessionId, cookieJson } = await req.json().catch(() => ({}));
    if (!userId || !cookieJson) {
      return new Response(JSON.stringify({ error: "userId and cookieJson are required" }), {
        status: 400,
      });
    }

    const secretName = vaultSecretName(userId);

    // Remove any existing secret first (Vault's create_secret does not
    // upsert by name in all versions — verify against the installed pg
    // extension version; this defensive delete-then-create is the safe
    // default either way).
    await supabase
      .rpc("vault_delete_secret_by_name", {
        secret_name: secretName,
      })
      .catch(() => {
        // Ignore — secret may not exist yet. If this RPC helper doesn't exist
        // in the project yet, see the accompanying SQL migration file that
        // should be added alongside this function (not yet created — see
        // NOTEBOOKLM_INTEGRATION.md open items).
      });

    const { data, error } = await supabase.rpc("vault_create_secret", {
      secret_value: cookieJson,
      secret_name: secretName,
      secret_description: `NotebookLM session for user ${userId}, captured ${new Date().toISOString()} (session ${sessionId ?? "unknown"})`,
    });

    if (error) {
      console.error("Vault store failed:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
      });
    }

    // Track connection metadata (NOT the secret itself) in a normal table
    // so the UI can show "Connected" / "Last connected: ..." without ever
    // reading the cookie back out. This table (notebooklm_connections) is
    // assumed but not yet created — see open items in
    // NOTEBOOKLM_INTEGRATION.md.
    const { error: metaError } = await supabase.from("notebooklm_connections").upsert({
      user_id: userId,
      vault_secret_name: secretName,
      connected_at: new Date().toISOString(),
      status: "connected",
    });

    if (metaError) {
      console.error("Failed to record connection metadata:", metaError);
      // Not fatal to the auth flow itself — the secret is stored either way
      // — but surface it so it gets fixed rather than silently missing.
    }

    return new Response(JSON.stringify({ ok: true, data }), { status: 200 });
  }

  // --- POST /disconnect  (called by the authenticated bridge frontend) ---
  if (req.method === "POST" && path === "/disconnect") {
    // Authenticate the caller via their own JWT rather than trusting a
    // client-supplied userId in the body — the previous version trusted
    // whatever userId was posted, which would let any signed-in user
    // disconnect any other user's session just by knowing their id.
    const authHeader = req.headers.get("Authorization");
    const jwt = authHeader?.replace(/^Bearer\s+/i, "");
    if (!jwt) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
      });
    }
    const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
        status: 401,
      });
    }
    const userId = userData.user.id;

    const secretName = vaultSecretName(userId);
    const { error } = await supabase.rpc("vault_delete_secret_by_name", {
      secret_name: secretName,
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
      });
    }

    await supabase
      .from("notebooklm_connections")
      .update({ status: "disconnected", disconnected_at: new Date().toISOString() })
      .eq("user_id", userId);

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  // --- GET /status  (called by the authenticated bridge frontend) ---
  // Reports connection status for the CALLING user only (own JWT, same
  // auth pattern as /disconnect above) — lets the UI show "Connected" /
  // "Not connected" without ever reading the underlying secret.
  if (req.method === "GET" && path === "/status") {
    const authHeader = req.headers.get("Authorization");
    const jwt = authHeader?.replace(/^Bearer\s+/i, "");
    if (!jwt) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
      });
    }
    const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
        status: 401,
      });
    }

    const { data, error } = await supabase
      .from("notebooklm_connections")
      .select("status, connected_at, disconnected_at, last_used_at")
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    return new Response(
      JSON.stringify(
        data ?? {
          status: "disconnected",
          connected_at: null,
          disconnected_at: null,
          last_used_at: null,
        },
      ),
      { status: 200 },
    );
  }

  return new Response("Not found", { status: 404 });
});
