import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/setup")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Setup checklist · Google Nexus" },
      {
        name: "description",
        content:
          "Exact steps to create the Google OAuth web client, enable APIs, add secrets, and connect Google Nexus to Claude web.",
      },
      { property: "og:title", content: "Setup checklist · Google Nexus" },
      {
        property: "og:description",
        content: "Google Cloud credentials, secrets and Claude connector steps for Google Nexus.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Setup,
});

const APIS = [
  "Gmail API",
  "Google Drive API",
  "Google Docs API",
  "Google Sheets API",
  "Google Slides API",
  "Google Calendar API",
  "Google Tasks API",
  "People API",
  "Google Meet API",
  "Google Chat API",
  "Google Forms API",
  "Apps Script API",
  "Generative Language API (for Gemini / Imagen / Veo)",
  "Vertex AI API (only for Lyria music)",
];

function Setup() {
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-6 py-14">
      <Link to="/" className="font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">
        ← Google Nexus
      </Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight text-foreground">Setup checklist</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Everything you fill in by hand, in order. Roughly 10 minutes.
      </p>

      <Step n={1} title="Create a Google Cloud project">
        <p>
          Go to console.cloud.google.com, create a project (any name), and keep its{" "}
          <strong>Project ID</strong> — you'll need it only if you want Lyria music generation.
        </p>
      </Step>

      <Step n={2} title="Enable the APIs">
        <p>APIs &amp; Services → Library → search and enable each of these:</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {APIS.map((api) => (
            <li key={api}>{api}</li>
          ))}
        </ul>
      </Step>

      <Step n={3} title="Configure the OAuth consent screen">
        <p>
          APIs &amp; Services → OAuth consent screen. Choose <strong>External</strong>, fill app name
          and support email, then add the scopes for the APIs above (Gmail, Drive, Docs, Sheets,
          Slides, Calendar, Tasks, Contacts, Meet, Chat, Forms, Apps Script). While the app is in
          Testing, add your own Google address under <strong>Test users</strong> — otherwise Google
          blocks the connection.
        </p>
      </Step>

      <Step n={4} title="Create the OAuth client — Web application">
        <p>
          APIs &amp; Services → Credentials → Create credentials → OAuth client ID → Application
          type: <strong>Web application</strong>. Not Desktop, not TV — Desktop clients cannot use an
          https redirect URI, so web Claude would fail.
        </p>
        <p className="mt-2">Add these Authorized redirect URIs (both, exactly):</p>
        <pre className="mt-2 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
          {origin}/api/public/google/callback
          {"\n"}https://YOUR-PUBLISHED-DOMAIN/api/public/google/callback
        </pre>
        <p className="mt-2">
          Copy the <strong>Client ID</strong> and <strong>Client secret</strong>.
        </p>
      </Step>

      <Step n={5} title="Get a Gemini API key">
        <p>
          aistudio.google.com → Get API key → create a key in the same Cloud project. This powers
          Gemini text, Imagen images and Veo video.
        </p>
      </Step>

      <Step n={6} title="Add the secrets in Lovable">
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>
            <code>GOOGLE_OAUTH_CLIENT_ID</code> — from step 4
          </li>
          <li>
            <code>GOOGLE_OAUTH_CLIENT_SECRET</code> — from step 4
          </li>
          <li>
            <code>GOOGLE_AI_API_KEY</code> — from step 5
          </li>
          <li>
            <code>GOOGLE_CLOUD_PROJECT</code> — Project ID from step 1 (optional, Lyria music only)
          </li>
        </ul>
        <p className="mt-2">
          Encryption keys (<code>NEXUS_TOKEN_ENC_KEY</code>,{" "}
          <code>NEXUS_OAUTH_STATE_SECRET</code>) are already generated for you.
        </p>
      </Step>

      <Step n={7} title="Connect the Google account Claude will use">
        <p>
          Back on the <Link className="underline" to="/">dashboard</Link>, press{" "}
          <strong>Connect Google account for Claude</strong>, pick the account, and approve the
          consent screen. Then press <strong>Run health checks</strong>.
        </p>
      </Step>

      <Step n={8} title="Add the connector in Claude (web)">
        <p>
          Claude → Settings → Connectors → <strong>Add custom connector</strong> → paste{" "}
          <code className="break-all">{origin}/mcp</code>. Claude opens this app's consent page:
          click <strong>Authorize</strong>, then confirm <strong>Yes</strong>. Done — Claude now sees
          the Google Nexus tools.
        </p>
      </Step>
    </main>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 rounded-xl border border-border bg-card p-6">
      <h2 className="text-lg font-semibold text-card-foreground">
        <span className="mr-2 font-mono text-sm text-muted-foreground">{n}</span>
        {title}
      </h2>
      <div className="mt-3 space-y-1 text-sm text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs">
        {children}
      </div>
    </section>
  );
}