import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import {
  disconnectGoogle,
  getNexusStatus,
  runNexusCapability,
  runNexusHealthChecks,
  startGoogleConnect,
} from "@/lib/nexus/nexus.functions";
import { useSession } from "@/lib/useSession";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Google Nexus — one Google connection for Claude" },
      {
        name: "description",
        content:
          "Google Nexus is a unified gateway that exposes Gmail, Drive, Docs, Sheets, Calendar, Meet, Gemini, Imagen, Veo and more to Claude through a single MCP connection.",
      },
      { property: "og:title", content: "Google Nexus — one Google connection for Claude" },
      {
        property: "og:description",
        content:
          "Connect one Google account and give Claude Gmail, Drive, Docs, Sheets, Calendar, Meet, Gemini, Imagen and Veo through one MCP endpoint.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { session, loading } = useSession();
  const queryClient = useQueryClient();
  const fetchStatus = useServerFn(getNexusStatus);
  const connect = useServerFn(startGoogleConnect);
  const disconnect = useServerFn(disconnectGoogle);
  const runCapability = useServerFn(runNexusCapability);
  const runHealth = useServerFn(runNexusHealthChecks);

  const status = useQuery({
    queryKey: ["nexus-status"],
    queryFn: () => fetchStatus(),
    enabled: Boolean(session),
  });

  const connectMutation = useMutation({
    mutationFn: () => connect(),
    onSuccess: (result) => {
      window.location.href = result.authorizationUrl;
    },
  });
  const disconnectMutation = useMutation({
    mutationFn: () => disconnect(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["nexus-status"] }),
  });
  const healthMutation = useMutation({ mutationFn: () => runHealth() });

  const [capabilityId, setCapabilityId] = useState("drive.search");
  const [payload, setPayload] = useState('{ "query": "report" }');
  const [output, setOutput] = useState<string | null>(null);
  const testMutation = useMutation({
    mutationFn: async () => {
      let parsed: unknown = {};
      if (payload.trim()) parsed = JSON.parse(payload);
      return runCapability({ data: { capabilityId, input: parsed } });
    },
    onSuccess: (result) => setOutput(result.ok ? result.resultJson : `Error: ${result.error}`),
    onError: (error: Error) => setOutput(`Error: ${error.message}`),
  });

  const mcpUrl = typeof window === "undefined" ? "/mcp" : `${window.location.origin}/mcp`;
  const data = status.data;
  const grouped = useMemo(() => {
    const map = new Map<string, typeof data extends undefined ? never : NonNullable<typeof data>["capabilities"]>();
    for (const capability of data?.capabilities ?? []) {
      const list = map.get(capability.serviceLabel) ?? [];
      list.push(capability);
      map.set(capability.serviceLabel, list);
    }
    return Array.from(map.entries());
  }, [data]);

  if (loading) {
    return <Shell><p className="text-sm text-muted-foreground">Loading…</p></Shell>;
  }

  if (!session) {
    return (
      <Shell>
        <Hero />
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to="/auth" search={{ next: "/" }}>
              Sign in to the gateway
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/setup">Setup checklist</Link>
          </Button>
        </div>
      </Shell>
    );
  }

  const connection = data?.connection;

  return (
    <Shell>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <Hero />
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="font-mono">{session.user.email}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await supabase.auth.signOut();
              window.location.href = "/";
            }}
          >
            Sign out
          </Button>
        </div>
      </div>

      <section className="mt-10 rounded-xl border border-border bg-card p-6">
        <h2 className="text-lg font-semibold text-card-foreground">
          Step 1 · Connect the Google account Claude should use
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Sign in with the Google account whose Gmail, Drive, Calendar and Workspace data Claude may
          act on. Tokens are encrypted at rest and refreshed automatically.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button
            size="lg"
            disabled={connectMutation.isPending || data?.oauthConfigured === false}
            onClick={() => connectMutation.mutate()}
          >
            {connection ? "Reconnect Google account" : "Connect Google account for Claude"}
          </Button>
          {connection && (
            <Button
              variant="outline"
              disabled={disconnectMutation.isPending}
              onClick={() => disconnectMutation.mutate()}
            >
              Disconnect
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={healthMutation.isPending || !connection}
            onClick={() => healthMutation.mutate()}
          >
            Run health checks
          </Button>
        </div>
        {data?.oauthConfigured === false && (
          <p className="mt-4 text-sm text-destructive">
            Google OAuth client is not configured yet. Add GOOGLE_OAUTH_CLIENT_ID and
            GOOGLE_OAUTH_CLIENT_SECRET — see the <Link className="underline" to="/setup">setup checklist</Link>.
          </p>
        )}
        {connectMutation.error && (
          <p className="mt-4 text-sm text-destructive">{(connectMutation.error as Error).message}</p>
        )}
        <dl className="mt-6 grid gap-4 sm:grid-cols-3">
          <Stat label="Google account" value={connection?.email ?? "Not connected"} />
          <Stat label="Granted scopes" value={String(connection?.scopeCount ?? 0)} />
          <Stat
            label="Generative AI key"
            value={data?.geminiConfigured ? "Configured" : "Missing GOOGLE_AI_API_KEY"}
          />
        </dl>
        {connection?.lastError && (
          <p className="mt-4 font-mono text-xs text-destructive">{connection.lastError}</p>
        )}
        {healthMutation.data && (
          <ul className="mt-6 space-y-1 font-mono text-xs">
            {healthMutation.data.results.map((result) => (
              <li key={result.service} className={result.ok ? "text-muted-foreground" : "text-destructive"}>
                {result.ok ? "ok" : "fail"} · {result.service} · {result.detail}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-border bg-card p-6">
        <h2 className="text-lg font-semibold text-card-foreground">
          Step 2 · Add the connector in Claude
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          In Claude (web) open Settings → Connectors → Add custom connector and paste this URL. Claude
          then shows two prompts: <strong>Authorize</strong>, then <strong>Yes</strong> to confirm.
        </p>
        <code className="mt-4 block break-all rounded-md bg-muted px-4 py-3 font-mono text-sm">
          {mcpUrl}
        </code>
        <Button className="mt-4" variant="outline" onClick={() => navigator.clipboard.writeText(mcpUrl)}>
          Copy MCP URL
        </Button>
      </section>

      <section className="mt-6 rounded-xl border border-border bg-card p-6">
        <h2 className="text-lg font-semibold text-card-foreground">Capability tester</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Run any capability exactly as Claude would, to verify a live Google call.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-[240px_1fr]">
          <Input value={capabilityId} onChange={(event) => setCapabilityId(event.target.value)} />
          <Textarea
            rows={3}
            className="font-mono text-xs"
            value={payload}
            onChange={(event) => setPayload(event.target.value)}
          />
        </div>
        <Button className="mt-3" disabled={testMutation.isPending} onClick={() => testMutation.mutate()}>
          Run capability
        </Button>
        {output && (
          <pre className="mt-4 max-h-72 overflow-auto rounded-md bg-muted p-4 font-mono text-xs">
            {output}
          </pre>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-border bg-card p-6">
        <h2 className="text-lg font-semibold text-card-foreground">
          {data?.capabilities.length ?? 0} capabilities across {data?.services.length ?? 0} services
        </h2>
        <div className="mt-4 space-y-6">
          {grouped.map(([label, capabilities]) => (
            <div key={label}>
              <h3 className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
                {label}
              </h3>
              <ul className="mt-2 divide-y divide-border">
                {capabilities.map((capability) => (
                  <li key={capability.id} className="flex flex-wrap items-baseline gap-x-3 py-2">
                    <code className="font-mono text-sm text-foreground">{capability.id}</code>
                    {capability.mutating && <Badge variant="secondary">write</Badge>}
                    <span className="text-sm text-muted-foreground">{capability.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-border bg-card p-6">
        <h2 className="text-lg font-semibold text-card-foreground">Recent operations</h2>
        {(data?.logs.length ?? 0) === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No calls yet.</p>
        ) : (
          <ul className="mt-3 space-y-1 font-mono text-xs">
            {data?.logs.map((log) => (
              <li key={log.id} className={log.success ? "text-muted-foreground" : "text-destructive"}>
                {new Date(log.created_at).toLocaleTimeString()} · {log.capability} · {log.actor} ·{" "}
                {log.duration_ms}ms {log.error_message ? `· ${log.error_message}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-8 text-sm text-muted-foreground">
        Need credentials? Follow the <Link className="underline" to="/setup">setup checklist</Link>.
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-14">{children}</main>
  );
}

function Hero() {
  return (
    <div>
      <p className="font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">
        Universal Google gateway
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
        Google Nexus
      </h1>
      <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
        One connection that gives Claude Gmail, Drive, Docs, Sheets, Slides, Calendar, Tasks,
        Contacts, Meet, Chat, Forms, Apps Script, Gemini, Imagen, Veo, Lyria, Flow projects and
        grounded notebooks.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border px-4 py-3">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-all font-mono text-sm text-foreground">{value}</dd>
    </div>
  );
}
