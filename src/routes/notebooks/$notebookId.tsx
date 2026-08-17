import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";

import { Badge } from "@/components/ui/badge";
import { getNotebook } from "@/lib/nexus/nexus.functions";
import { useSession } from "@/lib/useSession";

export const Route = createFileRoute("/notebooks/$notebookId")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Notebook — Google Nexus" }],
  }),
  component: NotebookDetail,
});

interface SourceSummary {
  id: string;
  kind: string;
  title: string;
  reference: string | null;
  char_count: number;
}

interface NotebookDetailData {
  notebook: {
    id: string;
    title: string;
    description: string | null;
    created_at: string;
    updated_at: string;
  };
  sources: SourceSummary[];
}

function NotebookDetail() {
  const { notebookId } = Route.useParams();
  const { session, loading } = useSession();
  const fetchNotebook = useServerFn(getNotebook);

  const query = useQuery({
    queryKey: ["notebook", notebookId],
    queryFn: () => fetchNotebook({ data: { notebookId } }),
    enabled: Boolean(session),
  });

  if (loading) return null;

  if (!session) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold">Notebook</h1>
        <p className="mt-2 text-muted-foreground">Sign in to view this notebook.</p>
        <Link
          className="mt-4 inline-block underline"
          to="/auth"
          search={{ next: `/notebooks/${notebookId}` }}
        >
          Sign in
        </Link>
      </main>
    );
  }

  const data = query.data?.ok ? (query.data.result as NotebookDetailData) : null;

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Link className="text-sm underline" to="/notebooks">
        ← All notebooks
      </Link>

      {query.isLoading && <p className="mt-6 text-sm text-muted-foreground">Loading…</p>}
      {query.data && !query.data.ok && (
        <p className="mt-6 text-sm text-destructive">{query.data.error}</p>
      )}

      {data && (
        <>
          <div className="mt-6 flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{data.notebook.title}</h1>
            {data.notebook.title === "Memory" && <Badge variant="secondary">Claude memory</Badge>}
          </div>
          {data.notebook.description && (
            <p className="mt-2 text-muted-foreground">{data.notebook.description}</p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            Updated {new Date(data.notebook.updated_at).toLocaleString()}
          </p>

          <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Sources ({data.sources.length})
          </h2>
          <div className="mt-3 space-y-4">
            {data.sources.length === 0 && (
              <p className="text-sm text-muted-foreground">No sources yet.</p>
            )}
            {data.sources.map((source) => (
              <SourceCard key={source.id} notebookId={notebookId} source={source} />
            ))}
          </div>
        </>
      )}
    </main>
  );
}

function SourceCard({ source }: { notebookId: string; source: SourceSummary }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">{source.title}</h3>
        <Badge variant="outline">{source.kind}</Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {source.char_count.toLocaleString()} characters
        {source.reference ? ` · ${source.reference}` : ""}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        Full text isn't shown here to keep this page light — ask Claude to summarize or query this
        notebook, or fetch it via notebook.ask / notebook.summarize.
      </p>
    </div>
  );
}
