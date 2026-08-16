import { getRequest } from "@tanstack/react-start/server";

import { NexusError } from "./errors";
import {
  buildAuthorizationUrl,
  createPkcePair,
  googleOAuthConfig,
  OAUTH_CALLBACK_PATH,
} from "./oauth.server";
import { allRequiredScopes } from "./registry";
import { randomBytes } from "node:crypto";

export function callbackUrlFor(requestUrl: string): string {
  const url = new URL(requestUrl);
  return `${url.protocol}//${url.host}${OAUTH_CALLBACK_PATH}`;
}

/**
 * Creates the Google consent URL for one user. State + PKCE verifier are stored
 * server-side so the callback can verify the round trip.
 */
export async function beginGoogleConnect(userId: string) {
  const config = googleOAuthConfig();
  if (!config.configured) {
    throw new NexusError(
      "oauth_not_configured",
      "Google OAuth client is not configured yet. Add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.",
      503,
    );
  }
  const request = getRequest();
  const redirectUri = callbackUrlFor(request.url);
  const state = randomBytes(24).toString("base64url");
  const { verifier, challenge } = createPkcePair();

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("oauth_states").delete().eq("user_id", userId);
  const { error } = await supabaseAdmin.from("oauth_states").insert({
    state,
    user_id: userId,
    code_verifier: verifier,
    redirect_to: "/",
  });
  if (error) throw error;

  return {
    authorizationUrl: buildAuthorizationUrl({
      redirectUri,
      state,
      codeChallenge: challenge,
      scopes: allRequiredScopes(),
    }),
    redirectUri,
  };
}
