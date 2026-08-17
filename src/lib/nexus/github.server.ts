import { NexusError } from "./errors";

/**
 * Shared client for the GitHub REST API, authenticated with a fine-grained
 * personal access token. https://docs.github.com/en/rest
 *
 * Deliberately separate from Google OAuth — GitHub access is its own
 * credential, read from GITHUB_TOKEN, and is never committed to source or
 * hardcoded here. Add it as an environment secret in the Nexus deployment
 * (same place GOOGLE_AI_API_KEY lives), not in code.
 */
export const GITHUB_BASE = "https://api.github.com";

export function githubToken(): string | undefined {
  const token = process.env["GITHUB_TOKEN"]?.trim();
  return token ? token : undefined;
}

export function requireGithubToken(): string {
  const token = githubToken();
  if (!token) {
    throw new NexusError(
      "github_not_configured",
      "This capability needs a GitHub personal access token. Add GITHUB_TOKEN as an environment secret in the Nexus deployment (Lovable project settings), scoped to only the repositories it should touch. Never paste the token into chat or commit it to a repo.",
      503,
    );
  }
  return token;
}

export async function githubFetch(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  return fetch(`${GITHUB_BASE}/${path.replace(/^\//, "")}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: {
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      authorization: `Bearer ${requireGithubToken()}`,
      "x-github-api-version": "2022-11-28",
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

export async function githubJson<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await githubFetch(path, init);
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    const message =
      (payload as { message?: string } | null)?.message ??
      (typeof payload === "string" && payload ? payload : `GitHub API HTTP ${response.status}`);
    throw new NexusError(
      "github_error",
      message,
      response.status === 401 || response.status === 403 ? response.status : 502,
    );
  }
  return payload as T;
}
