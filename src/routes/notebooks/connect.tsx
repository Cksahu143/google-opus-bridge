import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

// UNTESTED — written for review. Requires the login-service companion
// (see /login-service in repo root) to be deployed and reachable at
// LOGIN_SERVICE_URL below before this page will actually work.
//
// This page works from an iPad's Safari because the actual browser doing
// the Google login is remote (Browserbase), streamed into this page via an
// <iframe>. The iPad user taps/types inside that iframe exactly like a
// normal login page — nothing native or app-wrapper related is needed.

export const Route = createFileRoute("/notebooks/connect")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Connect NotebookLM · Google Nexus" },
      {
        name: "description",
        content: "Connect your real NotebookLM account so Claude can create and manage real notebooks.",
      },
    ],
  }),
  component: ConnectNotebookLmPage,
});

// CONFIRM this matches wherever login-service actually gets deployed —
// it is a separate service from this TanStack Start app and needs its own
// hosting (see login-service/README.md).
const LOGIN_SERVICE_URL =
  import.meta.env.VITE_NOTEBOOKLM_LOGIN_SERVICE_URL ?? "http://localhost:8787";

type ConnectState =
  | { step: "idle" }
  | { step: "starting" }
  | { step: "awaiting-login"; sessionId: string; liveViewUrl: string }
  | { step: "completing"; sessionId: string }
  | { step: "connected" }
  | { step: "error"; message: string };

function ConnectNotebookLmPage() {
  const [state, setState] = useState<ConnectState>({ step: "idle" });
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
    });
  }, []);

  async function startConnect() {
    if (!userId) {
      setState({ step: "error", message: "You must be signed in to connect NotebookLM." });
      return;
    }
    setState({ step: "starting" });
    try {
      const res = await fetch(`${LOGIN_SERVICE_URL}/connect/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { sessionId, liveViewUrl } = await res.json();
      setState({ step: "awaiting-login", sessionId, liveViewUrl });
    } catch (err) {
      setState({ step: "error", message: String((err as Error)?.message ?? err) });
    }
  }

  async function finishConnect(sessionId: string) {
    setState({ step: "completing", sessionId });
    try {
      const res = await fetch(`${LOGIN_SERVICE_URL}/connect/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      if (!res.ok) throw new Error(await res.text());
      setState({ step: "connected" });
    } catch (err) {
      setState({ step: "error", message: String((err as Error)?.message ?? err) });
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-16">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">
          Google Nexus
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
          Connect NotebookLM
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This connects your real NotebookLM account (not the separate Nexus-managed notebooks
          used elsewhere in this app). You&apos;ll log into Google in the embedded window below —
          works the same on iPad, iPhone, or desktop, since it&apos;s a regular web page, not a
          native login.
        </p>
      </div>

      {state.step === "idle" && (
        <Button onClick={startConnect} disabled={!userId}>
          Connect NotebookLM
        </Button>
      )}

      {state.step === "starting" && <p className="text-sm text-muted-foreground">Starting a secure login session…</p>}

      {state.step === "awaiting-login" && (
        <div className="space-y-4">
          <div className="overflow-hidden rounded-lg border border-border" style={{ aspectRatio: "16 / 10" }}>
            {/* This iframe loads a REAL, live, remote browser session (Browserbase).
                It is not a screenshot — the user can tap/type in it directly. */}
            <iframe
              src={state.liveViewUrl}
              title="NotebookLM login"
              className="h-full w-full"
              allow="clipboard-write"
            />
          </div>
          <p className="text-sm text-muted-foreground">
            Log into your Google account above. Once you see your NotebookLM notebooks load inside
            the window, tap the button below.
          </p>
          <Button onClick={() => finishConnect(state.sessionId)}>
            I&apos;m done logging in
          </Button>
        </div>
      )}

      {state.step === "completing" && (
        <p className="text-sm text-muted-foreground">Saving your connection securely…</p>
      )}

      {state.step === "connected" && (
        <p className="text-sm text-foreground">
          NotebookLM connected. Claude can now create and manage your real notebooks.
        </p>
      )}

      {state.step === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}
    </main>
  );
}
