import { useState } from "react";
import { useAI } from "../../components/ai/AIContext";
import { Icon } from "../../components/Icon";
import { QuestionCard } from "../../components/QuestionCard";
import { Button, Card, cx, ErrorBox, Loading, PageHeader, ProgressBar, Stat, Tabs } from "../../components/ui";
import { api } from "../../lib/api";
import { pct } from "../../lib/format";
import { Link, Navigate, useParams } from "../../lib/router";
import { useAsync } from "../../lib/useAsync";

export default function ExamReviewPage() {
  const { id } = useParams<{ id: string }>();
  const { open } = useAI();
  const { data, error, loading, reload } = useAsync(() => api.examGet(id), [id]);
  const [filter, setFilter] = useState<"all" | "wrong" | "flagged">("all");

  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? "Not found"} onRetry={reload} />;
  if (data.attempt.status === "in_progress") return <Navigate to={`/exam/${id}`} />;
  const r = data.result!;
  const back = data.config.section === "C" ? "/mock" : "/final";
  const items = data.items.filter((i) => filter === "all" || (filter === "wrong" ? !i.is_correct : i.flagged));

  return (
    <div className="mx-auto max-w-4xl">
      <Link to={back} className="ink-2 mb-3 inline-flex items-center gap-1 text-sm hover:underline"><Icon name="chevronLeft" size={16} />Back to Section {data.config.section}</Link>
      <PageHeader eyebrow={`${data.config.title} · Paper ${data.paper.paper_number}`} title="Your results"
        subtitle={data.attempt.status === "expired" ? "Time ran out, so the paper was submitted automatically." : undefined} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Stat label="Score" value={pct(r.percent, 1)} hint={`${r.score} of ${r.total}`} />
        <Stat label="Answered" value={`${r.answered}/${r.total}`} />
        <Stat label="Pass mark" value={r.pass_mark_percent !== null ? pct(r.pass_mark_percent) : "—"} hint="Set for this practice paper" />
        <Stat label="Outcome" value={r.passed === null ? "—" : r.passed ? "Pass" : "Below pass mark"} />
      </div>
      <p className="ink-2 mt-2 text-xs">Practice result only. It isn't an official NMCN result or certification.</p>

      <Card className="mt-6">
        <h2 className="mb-3 font-semibold">Performance by topic</h2>
        <ul className="space-y-3">
          {r.by_topic.map((t) => (
            <li key={t.topic}>
              <div className="mb-1 flex justify-between text-sm"><span>{t.topic}</span><span className="font-semibold">{t.correct}/{t.total} · {pct(t.percent)}</span></div>
              <ProgressBar value={t.percent} tone={t.percent < 50 ? "danger" : t.percent < 70 ? "accent" : "brand"} label={t.topic} />
            </li>
          ))}
        </ul>
      </Card>

      {data.review_available ? (
        <section className="mt-6">
          <h2 className="mb-3 text-lg font-semibold">Answer review</h2>
          <Tabs value={filter} onChange={setFilter} tabs={[
            { id: "all", label: `All (${data.items.length})` },
            { id: "wrong", label: `Incorrect (${data.items.filter((i) => !i.is_correct).length})` },
            { id: "flagged", label: `Flagged (${data.items.filter((i) => i.flagged).length})` },
          ]} />
          <div className="space-y-4">
            {items.map((item) => (
              <Card key={item.position} className={cx("sm:p-6", item.is_correct ? "" : "border-red-200 dark:border-red-900")}>
                <QuestionCard item={item} number={item.position} total={data.items.length} selected={item.selected_option_id} feedback={item.feedback} />
                {!item.selected_option_id && <p className="mt-2 text-sm font-medium text-red-600">Not answered</p>}
                <div className="mt-3 flex justify-end">
                  <Button size="sm" variant="accent" icon="sparkles"
                    onClick={() => open({ kind: "question", text: item.stem, questionId: item.question_id, topicId: item.topic_id, action: "rationale_expand" })}>
                    Explain with AI
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </section>
      ) : (
        <Card className="mt-6"><p className="ink-2 text-sm">Answer review isn't available for this paper.</p></Card>
      )}
    </div>
  );
}
