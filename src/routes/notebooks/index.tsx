import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";

import { Badge } from "@/components/ui/badge";
import { listNotebooks } from "@/lib/nexus/nexus.functions";
import { useSession } from "@/lib/useSession";

export const Route = createFileRoute("/notebooks/")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Notebooks — Google Nexus" }],
  }),
  component: NotebooksList,
});

interface NotebookSummary {
  id: string;
  title: string;
  description: string | null;
  sourceCount: number;
  updated_at: string;
  url: string;
}

function NotebooksList() {
  const { session, loading } = useSession();
  const fetchNotebooks = useServerFn(listNotebooks);

  const query = useQuery({
    queryKey: ["notebooks"],
    queryFn: () => fetchNotebooks(),
    enabled: Boolean(session),
  });

  if (loading) return null;

  if (!session) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold">Notebooks</h1>
        <p className="mt-2 text-muted-foreground">
          Sign in to see the notebooks created for your account, including anything Claude has
          remembered via <code className="rounded bg-muted px-1 py-0.5">memory.remember</code>.
        </p>
        <Link className="mt-4 inline-block underline" to="/auth" search={{ next: "/notebooks" }}>
          Sign in
        </Link>
      </main>
    );
  }

  const notebooks = (query.data?.notebooks ?? []) as NotebookSummary[];

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Notebooks</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every grounded notebook on your account — created by you or by Claude through this
            connector. All of it lives in your own account; nothing here belongs to a separate
            identity.
          </p>
        </div>
        <Link className="text-sm underline" to="/">
          ← Dashboard
        </Link>
      </div>

      {query.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {query.data && !query.data.ok && (
        <p className="text-sm text-destructive">{query.data.error}</p>
      )}
      {query.data?.ok && notebooks.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No notebooks yet. Ask Claude to remember something, or create one with notebook.create.
        </p>
      )}

      <div className="space-y-3">
        {notebooks.map((notebook) => (
          <Link
            key={notebook.id}
            to="/notebooks/$notebookId"
            params={{ notebookId: notebook.id }}
            className="block rounded-lg border p-4 transition hover:border-foreground/30"
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-medium">{notebook.title}</h2>
                  {notebook.title === "Memory" && <Badge variant="secondary">Claude memory</Badge>}
                </div>
                {notebook.description && (
                  <p className="mt-1 text-sm text-muted-foreground">{notebook.description}</p>
                )}
              </div>
              <Badge variant="outline">
                {notebook.sourceCount} source{notebook.sourceCount === 1 ? "" : "s"}
              </Badge>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
