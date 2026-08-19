import { z } from "zod";

import {
  getLinks,
  getMarkdown,
  getRenderedHtml,
  getScreenshot,
  runBrowserScript,
  scrapeSelectors,
} from "@/lib/nexus/browser.server";
import { defineAdapter, defineCapability } from "@/lib/nexus/types";

/**
 * A real browser tool, built for this app's actual deployment target
 * (Cloudflare Workers) rather than assuming a local Playwright/Puppeteer
 * process is available — it isn't; Workers isolates cannot spawn a browser
 * binary. Two real, HTTP-based backends instead:
 *   - Cloudflare Browser Rendering: reading pages (rendered HTML, markdown,
 *     screenshots, CSS-selector DOM scraping, links) — fast, single action.
 *   - Browserless /function: genuine multi-step interaction (click, fill,
 *     wait, then read the result) via a real Puppeteer script run
 *     server-side in one request.
 *
 * robots.txt is respected by default on every capability here. A site's
 * robots.txt is the owner's explicit signal about what they want automated
 * — ignoreRobotsTxt exists as a visible, per-call override, not a default
 * bypass, and this tool should not be used to defeat CAPTCHAs, bot
 * detection, paywalls, or login walls.
 */
export const browserAdapter = defineAdapter({
  service: "browser",
  label: "Browser",
  description:
    "Read any page's rendered content/DOM, screenshot it, or interact with it (click/fill) via a real headless browser.",
  status: "requires-configuration",
  statusNote:
    "Content/screenshot/scrape/links/markdown need CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_BROWSER_TOKEN (a Cloudflare API token with 'Browser Rendering - Edit' permission). Click/fill interaction additionally needs BROWSERLESS_API_TOKEN (free tier at browserless.io). robots.txt is respected by default.",
  docsUrl: "https://developers.cloudflare.com/browser-rendering/rest-api/",
  requiresGoogleAuth: false,
  capabilities: [
    defineCapability({
      id: "browser.get_content",
      title: "Get rendered page HTML",
      description:
        "Load a page with a real browser (runs JavaScript) and return the fully rendered HTML — unlike a plain fetch, this sees content that JS added after load.",
      implementation: "google-rest-api",
      scopes: [],
      input: z.object({
        url: z.string().url(),
        waitForSelector: z
          .string()
          .optional()
          .describe("CSS selector to wait for before capturing, for slow-loading content."),
        ignoreRobotsTxt: z.boolean().default(false),
      }),
      run: (_ctx, input) => getRenderedHtml(input).then((html) => ({ html })),
    }),
    defineCapability({
      id: "browser.get_markdown",
      title: "Get page as readable markdown",
      description:
        "Load a page and return its main content converted to markdown — good for reading an article without HTML noise.",
      implementation: "google-rest-api",
      scopes: [],
      input: z.object({
        url: z.string().url(),
        ignoreRobotsTxt: z.boolean().default(false),
      }),
      run: (_ctx, input) => getMarkdown(input).then((markdown) => ({ markdown })),
    }),
    defineCapability({
      id: "browser.screenshot",
      title: "Screenshot a page",
      description: "Render a page and capture a real screenshot (visible viewport or full page).",
      implementation: "google-rest-api",
      scopes: [],
      input: z.object({
        url: z.string().url(),
        fullPage: z.boolean().default(false),
        waitForSelector: z.string().optional(),
        ignoreRobotsTxt: z.boolean().default(false),
      }),
      run: (_ctx, input) => getScreenshot(input).then((screenshot) => ({ screenshot })),
    }),
    defineCapability({
      id: "browser.inspect_dom",
      title: "Inspect the DOM",
      description:
        "Query a rendered page with CSS selectors and get back each matching element's text, inner HTML, and attributes — real DOM inspection, not a guess from raw markup.",
      implementation: "google-rest-api",
      scopes: [],
      input: z.object({
        url: z.string().url(),
        selectors: z.array(z.string().min(1)).min(1).max(10),
        waitForSelector: z.string().optional(),
        ignoreRobotsTxt: z.boolean().default(false),
      }),
      run: (_ctx, input) => scrapeSelectors(input).then((elements) => ({ elements })),
    }),
    defineCapability({
      id: "browser.get_links",
      title: "Get all links on a page",
      description: "Load a page and return every link found on it after JavaScript runs.",
      implementation: "google-rest-api",
      scopes: [],
      input: z.object({
        url: z.string().url(),
        ignoreRobotsTxt: z.boolean().default(false),
      }),
      run: (_ctx, input) => getLinks(input).then((links) => ({ links })),
    }),
    defineCapability({
      id: "browser.interact",
      title: "Click, fill, and interact with a page",
      description:
        "Run a real multi-step interaction: click buttons, fill forms, wait for navigation, then read the result — everything a REST content/screenshot call can't do because those are single-action only. Provide the full Browserless function body as a string, e.g. `export default async ({ page, context }) => { await page.goto(context.url); await page.click('#accept'); await page.type('#search', 'query'); await page.waitForSelector('.results'); return { data: await page.$eval('.results', el => el.textContent) }; }`. `context.url` is set to the url you pass in.",
      implementation: "google-rest-api",
      scopes: [],
      mutating: true,
      input: z.object({
        url: z.string().url(),
        script: z.string().min(1),
        context: z.record(z.string(), z.unknown()).optional(),
        ignoreRobotsTxt: z.boolean().default(false),
      }),
      run: async (_ctx, input) => {
        const result = await runBrowserScript({
          url: input.url,
          script: input.script,
          context: { ...(input.context ?? {}), url: input.url },
          ignoreRobotsTxt: input.ignoreRobotsTxt,
        });
        return { result };
      },
    }),
  ],
});

export default browserAdapter;
