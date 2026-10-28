import { Button, Card, EmptyState, ErrorBox, Loading, PageHeader, cx } from "../../components/ui";
import { relative } from "../../lib/format";
import { Link } from "../../lib/router";
import { supabase } from "../../lib/supabase";
import { useAsync } from "../../lib/useAsync";

interface Notification { id: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string }

export default function NotificationsPage() {
  const { data, error, loading, reload } = useAsync(async () => {
    const { data, error } = await supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    return data as Notification[];
  }, []);
  const markAll = async () => {
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
    reload();
  };
  const markOne = (id: string) => supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Notifications" actions={<Button variant="secondary" size="sm" onClick={markAll}>Mark all as read</Button>} />
      {loading && <Loading />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && !data.length && <EmptyState icon="bell" title="You're all caught up" />}
      <div className="space-y-2">
        {data?.map((n) => {
          const inner = (
            <Card className={cx("flex gap-3", !n.read_at && "border-brand-300")}>
              {!n.read_at && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-label="Unread" />}
              <div className="flex-1">
                <div className="text-sm font-semibold">{n.title}</div>
                {n.body && <p className="ink-2 text-sm">{n.body}</p>}
                <div className="ink-2 mt-1 text-xs">{relative(n.created_at)}</div>
              </div>
            </Card>
          );
          return n.link?.startsWith("/")
            ? <Link key={n.id} to={n.link} onClick={() => markOne(n.id)}>{inner}</Link>
            : <div key={n.id} onClick={() => markOne(n.id)}>{inner}</div>;
        })}
      </div>
    </div>
  );
}
