import { decryptSecret, encryptSecret } from "./crypto.server";
import { notConnected } from "./errors";
import { refreshAccessToken, revokeToken } from "./oauth.server";

export interface StoredConnection {
  user_id: string;
  google_email: string | null;
  google_sub: string | null;
  access_token_ciphertext: string | null;
  refresh_token_ciphertext: string | null;
  access_token_expires_at: string | null;
  granted_scopes: string[];
  status: string;
  last_error: string | null;
  updated_at: string;
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function getConnection(userId: string): Promise<StoredConnection | null> {
  const db = await admin();
  const { data, error } = await db
    .from("google_connections")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as StoredConnection | null) ?? null;
}

export async function saveConnection(params: {
  userId: string;
  accessToken: string;
  refreshToken?: string | undefined;
  expiresInSeconds: number;
  scopes: string[];
  googleEmail?: string | undefined;
  googleSub?: string | undefined;
}) {
  const db = await admin();
  const existing = await getConnection(params.userId);
  const refreshCiphertext = params.refreshToken
    ? encryptSecret(params.refreshToken)
    : (existing?.refresh_token_ciphertext ?? null);

  const { error } = await db.from("google_connections").upsert(
    {
      user_id: params.userId,
      google_email: params.googleEmail ?? existing?.google_email ?? null,
      google_sub: params.googleSub ?? existing?.google_sub ?? null,
      access_token_ciphertext: encryptSecret(params.accessToken),
      refresh_token_ciphertext: refreshCiphertext,
      access_token_expires_at: new Date(Date.now() + params.expiresInSeconds * 1000).toISOString(),
      granted_scopes: params.scopes,
      status: "connected",
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw error;
}

export async function markConnectionError(userId: string, message: string) {
  const db = await admin();
  await db
    .from("google_connections")
    .update({ status: "needs_reauth", last_error: message })
    .eq("user_id", userId);
}

/** Returns a valid access token, refreshing it when it is close to expiry. */
export async function getAccessToken(userId: string): Promise<string> {
  const connection = await getConnection(userId);
  if (!connection) throw notConnected();

  const expiresAt = connection.access_token_expires_at
    ? Date.parse(connection.access_token_expires_at)
    : 0;
  const stillFresh = expiresAt - Date.now() > 60_000;
  if (stillFresh && connection.access_token_ciphertext) {
    return decryptSecret(connection.access_token_ciphertext);
  }

  if (!connection.refresh_token_ciphertext) {
    await markConnectionError(userId, "No refresh token stored; re-connect Google.");
    throw notConnected();
  }

  try {
    const refreshed = await refreshAccessToken(decryptSecret(connection.refresh_token_ciphertext));
    await saveConnection({
      userId,
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token,
      expiresInSeconds: refreshed.expires_in,
      scopes: refreshed.scope ? refreshed.scope.split(" ") : connection.granted_scopes,
    });
    return refreshed.access_token;
  } catch (error) {
    await markConnectionError(userId, (error as Error).message);
    throw error;
  }
}

export async function disconnect(userId: string) {
  const connection = await getConnection(userId);
  if (connection?.refresh_token_ciphertext) {
    // Revoke at Google first so the grant disappears from the user's account.
    await revokeToken(decryptSecret(connection.refresh_token_ciphertext)).catch(() => undefined);
  }
  const db = await admin();
  await db.from("google_connections").delete().eq("user_id", userId);
  await db.from("service_health").delete().eq("user_id", userId);
}

export function hasScopes(granted: string[], required: string[]): boolean {
  if (required.length === 0) return true;
  const set = new Set(granted);
  // `drive` implies drive.readonly/file for our purposes.
  return required.every(
    (scope) =>
      set.has(scope) ||
      (scope.startsWith("https://www.googleapis.com/auth/drive") &&
        set.has("https://www.googleapis.com/auth/drive")),
  );
}