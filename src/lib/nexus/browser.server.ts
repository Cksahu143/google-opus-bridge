import { NexusError } from "./errors";

/**
 * Client for Cloudflare's Browser Rendering REST API ("Quick Actions") —
 * a real headless-browser backend reachable over plain HTTP, which matters
 * because this app deploys to Cloudflare Workers: actual Playwright/
 * Puppeteer need to spawn a browser binary as an OS process, which a
 * Workers isolate cannot do. This API renders full JS pages, screenshots,
 * PDFs, and CSS-selector scrapes without needing a local browser at all.
 * https://developers.cloudflare.com/browser-rendering/rest-api/
 */
const BASE = "https://api.cloudflare.com/client/v4/accounts";

function credentials(): { accountId: string; token: string } {
  const accountId = process.env["CLOUDFLARE_ACCOUNT_ID"]?.trim();
  const token = process.env["CLOUDFLARE_BROWSER_TOKEN"]?.trim();
  if (!accountId || !token) {
    throw new NexusError(
      "browser_not_configured",
      "This capability needs Cloudflare Browser Rendering credentials. Create an API token with 'Browser Rendering - Edit' permission in the Cloudflare dashboard, then set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_BROWSER_TOKEN as environment secrets.",
      503,
    );
  }
  return { accountId, token };
}

/**
 * Fetches and parses robots.txt for a URL's origin, returning true if the
 * given path is disallowed for a generic crawler ("*"). Respected by
 * default in every capability below — a site's robots.txt is an explicit
 * "please don't automate this" signal, not a technicality to route around.
 * A caller can pass ignoreRobotsTxt to skip this check, but that's an
 * explicit, visible choice each time, not the default.
 */
export async function isDisallowedByRobots(targetUrl: string): Promise<boolean> {
  try {
    const url = new URL(targetUrl);
    const robotsUrl = `${url.origin}/robots.txt`;
    const response = await fetch(robotsUrl, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return false;
    const text = await response.text();
    const lines = text.split("\n").map((line) => line.trim());
    let applies = false;
    const disallowed: string[] = [];
    for (const line of lines) {
      const [rawKey, ...rest] = line.split(":");
      const key = rawKey?.toLowerCase().trim();
      const value = rest.join(":").trim();
      if (key === "user-agent") {
        applies = value === "*";
      } else if (applies && key === "disallow" && value) {
        disallowed.push(value);
      }
    }
    return disallowed.some((rule) => url.pathname.startsWith(rule));
  } catch {
    return false;
  }
}

async function robotsGuard(targetUrl: string, ignoreRobotsTxt: boolean): Promise<void> {
  if (ignoreRobotsTxt) return;
  if (await isDisallowedByRobots(targetUrl)) {
    throw new NexusError(
      "robots_disallowed",
      `${new URL(targetUrl).origin} disallows automated access to this path in robots.txt. Pass ignoreRobotsTxt: true to override this check — but that's the site owner's explicit signal not to automate this, not a technicality.`,
      403,
    );
  }
}

async function browserFetch<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  const { accountId, token } = credentials();
  const response = await fetch(`${BASE}/${accountId}/browser-rendering/${endpoint}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const payload = (await response.json()) as {
      success?: boolean;
      result?: T;
      errors?: { message: string }[];
    };
    if (!response.ok || payload.success === false) {
      throw new NexusError(
        "browser_error",
        payload.errors?.[0]?.message ?? `Browser Rendering API HTTP ${response.status}`,
        response.status === 401 || response.status === 403 ? response.status : 502,
      );
    }
    return payload.result as T;
  }
  // Binary response (screenshot/pdf) — caller handles this via browserFetchBinary instead.
  throw new NexusError("browser_unexpected_response", "Expected JSON, got a binary response.", 502);
}

async function browserFetchBinary(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<{ mimeType: string; base64: string }> {
  const { accountId, token } = credentials();
  const response = await fetch(`${BASE}/${accountId}/browser-rendering/${endpoint}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new NexusError(
      "browser_error",
      text || `Browser Rendering API HTTP ${response.status}`,
      502,
    );
  }
  const mimeType = response.headers.get("content-type") ?? "application/octet-stream";
  const buffer = Buffer.from(await response.arrayBuffer());
  return { mimeType, base64: buffer.toString("base64") };
}

export interface BrowserGotoOptions {
  url: string;
  ignoreRobotsTxt?: boolean | undefined;
  waitForSelector?: string | undefined;
  viewport?: { width: number; height: number } | undefined;
}

export async function getRenderedHtml(opts: BrowserGotoOptions): Promise<string> {
  await robotsGuard(opts.url, opts.ignoreRobotsTxt ?? false);
  const result = await browserFetch<string>("content", requestBody(opts));
  return typeof result === "string" ? result : "";
}

export async function getMarkdown(opts: BrowserGotoOptions): Promise<string> {
  await robotsGuard(opts.url, opts.ignoreRobotsTxt ?? false);
  const result = await browserFetch<string>("markdown", requestBody(opts));
  return typeof result === "string" ? result : "";
}

export async function getScreenshot(
  opts: BrowserGotoOptions & { fullPage?: boolean },
): Promise<{ mimeType: string; base64: string }> {
  await robotsGuard(opts.url, opts.ignoreRobotsTxt ?? false);
  return browserFetchBinary("screenshot", {
    ...requestBody(opts),
    screenshotOptions: { fullPage: opts.fullPage ?? false },
  });
}

export interface ScrapeElement {
  selector: string;
  results: { text: string; html: string; attributes: Record<string, string> }[];
}

export async function scrapeSelectors(
  opts: BrowserGotoOptions & { selectors: string[] },
): Promise<ScrapeElement[]> {
  await robotsGuard(opts.url, opts.ignoreRobotsTxt ?? false);
  const result = await browserFetch<ScrapeElement[]>("scrape", {
    ...requestBody(opts),
    elements: opts.selectors.map((selector) => ({ selector })),
  });
  return result;
}

export async function getLinks(opts: BrowserGotoOptions): Promise<string[]> {
  await robotsGuard(opts.url, opts.ignoreRobotsTxt ?? false);
  const result = await browserFetch<string[]>("links", requestBody(opts));
  return result;
}

function requestBody(opts: BrowserGotoOptions): Record<string, unknown> {
  return {
    url: opts.url,
    ...(opts.waitForSelector ? { waitForSelector: opts.waitForSelector } : {}),
    ...(opts.viewport ? { viewport: opts.viewport } : {}),
  };
}

/**
 * Cloudflare's Quick Actions above are stateless, single-action REST calls
 * — real for reading a page (content, screenshot, DOM scrape) but they
 * cannot click a button, then fill a form, then read the result in one
 * request. For genuine multi-step interaction, Browserless's /function
 * endpoint runs a full Puppeteer script server-side in one HTTP call —
 * still pure HTTP, still Workers-compatible, but a second real provider.
 * https://docs.browserless.io/rest-apis/function
 */
function browserlessToken(): string {
  const token = process.env["BROWSERLESS_API_TOKEN"]?.trim();
  if (!token) {
    throw new NexusError(
      "browserless_not_configured",
      "Multi-step browser interaction (clicking, filling forms) needs a Browserless token. Create a free one at browserless.io and set it as BROWSERLESS_API_TOKEN in the deployment's environment secrets.",
      503,
    );
  }
  return token;
}

/**
 * Runs a script against a real page via Browserless. The script receives
 * `page` (a Puppeteer Page) and `context` (the input object) and must
 * return a JSON-serializable value via `export default async ({ page,
 * context }) => { ... return { data: ... }; }`.
 */
export async function runBrowserScript(params: {
  url: string;
  script: string;
  context?: Record<string, unknown>;
  ignoreRobotsTxt?: boolean;
}): Promise<unknown> {
  await robotsGuard(params.url, params.ignoreRobotsTxt ?? false);
  const token = browserlessToken();
  const response = await fetch(`https://production-sfo.browserless.io/function?token=${token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: params.script, context: params.context ?? {} }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new NexusError("browserless_error", text || `Browserless HTTP ${response.status}`, 502);
  }
  try {
    const parsed = JSON.parse(text) as { data?: unknown };
    return "data" in parsed ? parsed.data : parsed;
  } catch {
    return text;
  }
}
