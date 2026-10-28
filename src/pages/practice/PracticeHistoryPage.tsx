import { useState } from "react";
import { Button, Card, EmptyState, ErrorBox, Loading, PageHeader, ProgressBar, StatusBadge, Tabs } from "../../components/ui";
import { api } from "../../lib/api";
import { dateTime, pct } from "../../lib/format";
import { Link } from "../../lib/router";
import { supabase } from "../../lib/supabase";
import type { PracticeSession } from "../../lib/types";
import { useAsync } from "../../lib/useAsync";

export default function PracticeHistoryPage() {
  const [tab, setTab] = useState<"history" | "topics" | "saved">("history");
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader eyebrow="Section B" title="Practice history" actions={<Link to="/practice"><Button icon="play">New session</Button></Link>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "history", label: "Sessions" }, { id: "topics", label: "Topic performance" }, { id: "saved", label: "Saved questions" }]} />
      {tab === "history" && <Sessions />}
      {tab === "topics" && <Topics />}
      {tab === "saved" && <Saved />}
    </div>
  );
}

function Sessions() {
  const { data, error, loading, reload } = useAsync(async () => {
    const { data, error } = await supabase.from("practice_sessions").select("*").order("started_at", { ascending: false }).limit(50);
    if (error) throw error;
    return data as PracticeSession[];
  }, []);
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data?.length) return <EmptyState icon="quiz" title="No sessions yet">Start a practice session to build your history.</EmptyState>;
  return (
    <div className="space-y-2">
      {data.map((s) => (
        <Link key={s.id} to={`/practice/session/${s.id}`}>
          <Card className="flex items-center gap-4 hover:border-brand-400">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{s.question_count} questions · {s.mode === "random" ? "New mix" : s.mode === "saved" ? "Saved" : "Retry mistakes"}</div>
              <div className="ink-2 text-xs">{dateTime(s.started_at)}</div>
            </div>
            <StatusBadge status={s.status} />
            <div className="w-20 text-right text-sm font-bold">{s.answered_count ? pct((100 * s.correct_count) / s.answered_count) : "—"}</div>
          </Card>
        </Link>
      ))}
    </div>
  );
}

function Topics() {
  const { data, error, loading, reload } = useAsync(() => api.topicStats(), []);
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data?.length) return <EmptyState icon="chart" title="No data yet">Answer some questions to see your performance by topic.</EmptyState>;
  const sorted = [...data].sort((a, b) => a.accuracy - b.accuracy);
  return (
    <Card>
      <ul className="space-y-4">
        {sorted.map((t) => (
          <li key={t.topic_id} className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex justify-between text-sm"><span className="truncate font-medium">{t.topic}</span><span className="ink-2 shrink-0 text-xs">{t.correct}/{t.answered}</span></div>
              <div className="ink-2 mb-1 text-xs">{t.course}</div>
              <ProgressBar value={t.accuracy} tone={t.accuracy < 50 ? "danger" : t.accuracy < 70 ? "accent" : "brand"} label={t.topic} />
            </div>
            <span className="w-12 text-right text-sm font-bold">{pct(t.accuracy)}</span>
            <Link to={`/practice?topic=${t.topic_id}`} className="text-sm font-medium text-brand-700 dark:text-brand-300">Practise</Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Saved() {
  const { data, error, loading, reload } = useAsync(async () => {
    const { data, error } = await supabase.from("bookmarks").select("id, created_at, questions(id, stem, difficulty)")
      .not("question_id", "is", null).order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as unknown as Array<{ id: string; created_at: string; questions: { id: string; stem: string; difficulty: string } | null }>;
  }, []);
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data?.length) return <EmptyState icon="bookmark" title="No saved questions">Tap the bookmark on any practice question to save it.</EmptyState>;
  return (
    <div className="space-y-3">
      <Link to="/practice?mode=saved"><Button icon="play">Practise saved questions</Button></Link>
      {data.filter((b) => b.questions).map((b) => (
        <Card key={b.id} className="flex items-start gap-3">
          <p className="flex-1 text-sm">{b.questions!.stem}</p>
          <button className="ink-2 text-xs underline" onClick={async () => { await supabase.from("bookmarks").delete().eq("id", b.id); reload(); }}>Remove</button>
        </Card>
      ))}
    </div>
  );
}
