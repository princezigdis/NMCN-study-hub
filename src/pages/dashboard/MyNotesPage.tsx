import { Card, EmptyState, ErrorBox, Loading, PageHeader } from "../../components/ui";
import { relative } from "../../lib/format";
import { Link } from "../../lib/router";
import { supabase } from "../../lib/supabase";
import { useAsync } from "../../lib/useAsync";

export default function MyNotesPage() {
  const { data, error, loading, reload } = useAsync(async () => {
    const { data, error } = await supabase.from("personal_notes").select("id, title, body, note_id, updated_at").order("updated_at", { ascending: false });
    if (error) throw error;
    return data as Array<{ id: string; title: string; body: string; note_id: string | null; updated_at: string }>;
  }, []);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="Section A" title="My personal notes" subtitle="Notes you've written alongside the library." />
      {loading && <Loading />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && !data.length && <EmptyState icon="edit" title="No personal notes yet">Open any note in the library and use “My notes on this topic”.</EmptyState>}
      <div className="space-y-2">
        {data?.map((n) => (
          <Card key={n.id}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{n.title}</span>
              {n.note_id && <Link to={`/library/note/${n.note_id}`} className="text-sm text-brand-700 underline dark:text-brand-300">Open note</Link>}
            </div>
            <div className="ink-2 text-xs">Updated {relative(n.updated_at)}</div>
            <p className="mt-2 whitespace-pre-wrap text-sm">{n.body}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
