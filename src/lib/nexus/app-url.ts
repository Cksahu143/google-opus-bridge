/**
 * Public base URL of this deployment, used to build real shareable links
 * (e.g. to a notebook's view page) from server-side capability code that
 * has no access to the incoming request's Origin header.
 *
 * Set APP_URL in the environment if this deployment ever moves off the
 * default Lovable domain.
 */
export function appBaseUrl(): string {
  return (process.env["APP_URL"]?.trim() || "https://google-opus-bridge.lovable.app").replace(
    /\/$/,
    "",
  );
}

export function notebookUrl(notebookId: string): string {
  return `${appBaseUrl()}/notebooks/${notebookId}`;
}
