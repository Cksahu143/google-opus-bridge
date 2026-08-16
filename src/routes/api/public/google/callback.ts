import { createFileRoute } from "@tanstack/react-router";

/**
 * Google OAuth redirect target. Public by necessity (Google calls it), but it is
 * only useful with a matching one-time `state` row created by a signed-in user.
 */
export const Route = createFileRoute("/api/public/google/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const error = url.searchParams.get("error");
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");

        if (error) return fail(`Google denied the request: ${error}`);
        if (!code || !state) return fail("Missing code or state in the Google callback.");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: stateRow } = await supabaseAdmin
          .from("oauth_states")
          .select("*")
          .eq("state", state)
          .maybeSingle();
        if (!stateRow) return fail("This sign-in link expired. Start the connection again.");
        await supabaseAdmin.from("oauth_states").delete().eq("state", state);

        const { exchangeCodeForTokens, fetchUserInfo } = await import("@/lib/nexus/oauth.server");
        const { callbackUrlFor } = await import("@/lib/nexus/connect.server");
        const { saveConnection } = await import("@/lib/nexus/connections.server");

        try {
          const tokens = await exchangeCodeForTokens({
            code,
            redirectUri: callbackUrlFor(request.url),
            codeVerifier: stateRow.code_verifier,
          });
          const profile = await fetchUserInfo(tokens.access_token);
          await saveConnection({
            userId: stateRow.user_id,
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiresInSeconds: tokens.expires_in,
            scopes: tokens.scope ? tokens.scope.split(" ") : [],
            googleEmail: profile.email,
            googleSub: profile.sub,
          });
        } catch (cause) {
          return fail((cause as Error).message);
        }

        return new Response(null, {
          status: 302,
          headers: { location: `${stateRow.redirect_to ?? "/"}?google=connected` },
        });
      },
    },
  },
});

function fail(message: string) {
  return new Response(null, {
    status: 302,
    headers: { location: `/?google=error&message=${encodeURIComponent(message)}` },
  });
}
