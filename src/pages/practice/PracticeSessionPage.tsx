import { useEffect, useMemo, useState } from "react";
import { useAI } from "../../components/ai/AIContext";
import { Icon } from "../../components/Icon";
import { QuestionCard } from "../../components/QuestionCard";
import { ReportDialog } from "../../components/ReportDialog";
import { Button, Card, cx, ErrorBox, Loading, ProgressBar, Stat, useToast } from "../../components/ui";
import { api } from "../../lib/api";
import { friendly } from "../../lib/errors";
import { pct } from "../../lib/format";
import { Link, useNavigate, useParams, useSearchParams } from "../../lib/router";
import { supabase } from "../../lib/supabase";
import type { QuestionItem } from "../../lib/types";
import { useAsync } from "../../lib/useAsync";

export default function PracticeSessionPage() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { open } = useAI();
  const { data, error, loading, reload, setData } = useAsync(() => api.practiceGet(id), [id]);
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [report, setReport] = useState<string | null>(null);

  // Resume at the first unanswered question.
  useEffect(() => {
    if (!data) return;
    const first = data.items.findIndex((i) => !i.selected_option_id);
    setIdx(first === -1 ? 0 : first);
    if (first === -1 && data.items.length) setShowSummary(true);
  }, [data?.session.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = data?.items ?? [];
  const item = items[idx];
  const answered = items.filter((i) => i.selected_option_id).length;
  const correct = items.filter((i) => i.is_correct).length;

  const answer = async (optionId: string) => {
    if (!data || !item || item.selected_option_id || busy) return;
    setBusy(true);
    try {
      const res = await api.practiceAnswer(id, item.position, optionId);
      const updated: QuestionItem = { ...item, selected_option_id: optionId, is_correct: res.is_correct, feedback: res.feedback };
      setData({ ...data, items: items.map((x) => (x.position === item.position ? updated : x)) });
    } catch (e) {
      toast(friendly(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const toggleSave = async () => {
    if (!data || !item) return;
    if (item.bookmarked) await supabase.from("bookmarks").delete().eq("question_id", item.question_id);
    else {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("bookmarks").insert({ user_id: u.user?.id, question_id: item.question_id });
      if (error) return toast(friendly(error), "error");
    }
    setData({ ...data, items: items.map((x) => (x.question_id === item.question_id ? { ...x, bookmarked: !x.bookmarked } : x)) });
  };

  const finish = async () => {
    await api.practiceFinish(id).catch(() => undefined);
    setShowSummary(true);
  };

  const byTopic = useMemo(() => {
    const m = new Map<string, { topic: string; correct: number; total: number }>();
    for (const i of items.filter((x) => x.selected_option_id)) {
      const k = i.topic ?? "Other";
      const v = m.get(k) ?? { topic: k, correct: 0, total: 0 };
      v.total += 1; if (i.is_correct) v.correct += 1;
      m.set(k, v);
    }
    return [...m.values()].sort((a, b) => a.correct / a.total - b.correct / b.total);
  }, [items]);

  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? "Session not found"} onRetry={reload} />;

  if (showSummary) {
    const wrong = answered - correct;
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-bold">Session summary</h1>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Score" value={pct(answered ? (100 * correct) / answered : 0)} />
          <Stat label="Correct" value={correct} hint={`of ${answered} answered`} />
          <Stat label="To review" value={wrong} />
        </div>
        <Card>
          <h2 className="mb-3 font-semibold">By topic</h2>
          <ul className="space-y-3">
            {byTopic.map((t) => (
              <li key={t.topic}>
                <div className="mb-1 flex justify-between text-sm"><span>{t.topic}</span><span className="font-semibold">{t.correct}/{t.total}</span></div>
                <ProgressBar value={t.correct} max={t.total} tone={t.correct / t.total < 0.5 ? "danger" : "brand"} label={t.topic} />
              </li>
            ))}
          </ul>
        </Card>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => { setShowSummary(false); setIdx(0); }}>Review answers</Button>
          {wrong > 0 && (
            <Button onClick={async () => {
              try {
                const r = await api.practiceStart({ count: 100, mode: "retry_incorrect" });
                navigate(`/practice/session/${r.session_id}`);
              } catch (e) { toast(friendly(e), "error"); }
            }}>Retry my mistakes</Button>
          )}
          <Link to="/practice"><Button variant="ghost">New session</Button></Link>
        </div>
      </div>
    );
  }

  if (!item) return <ErrorBox message="This session has no questions." />;
  const short = params.get("short");

  return (
    <div className="mx-auto max-w-3xl">
      {short && idx === 0 && !answered && (
        <div className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          Only {short} questions matched your filters, so this session has {short} questions.
        </div>
      )}
      <div className="mb-4 flex items-center gap-3">
        <Link to="/practice" className="ink-2 rounded-lg p-1 hover:bg-[var(--surface-2)]" aria-label="Exit session"><Icon name="x" /></Link>
        <div className="flex-1"><ProgressBar value={answered} max={items.length} label="Answered" /></div>
        <span className="text-sm font-semibold">{correct}/{answered} correct</span>
      </div>

      <Card className="sm:p-7">
        <QuestionCard item={item} number={idx + 1} total={items.length} selected={item.selected_option_id}
          onSelect={answer} feedback={item.feedback} disabled={busy}
          headerRight={
            <button onClick={toggleSave} className={cx("rounded-lg p-1.5", item.bookmarked ? "text-accent-500" : "ink-2")} aria-pressed={!!item.bookmarked} aria-label="Save question">
              <Icon name="bookmark" size={18} />
            </button>
          } />
        {item.feedback && (
          <div className={cx("mt-5 flex flex-wrap items-center gap-2 rounded-xl p-3",
            item.is_correct ? "bg-emerald-50 dark:bg-emerald-950/40" : "bg-red-50 dark:bg-red-950/40")}>
            <span className={cx("flex items-center gap-2 font-semibold", item.is_correct ? "text-emerald-800 dark:text-emerald-200" : "text-red-800 dark:text-red-200")}>
              <Icon name={item.is_correct ? "checkCircle" : "xCircle"} />{item.is_correct ? "Correct!" : "Not quite. See the rationales above."}
            </span>
            <div className="flex-1" />
            <Button size="sm" variant="accent" icon="sparkles"
              onClick={() => open({ kind: "question", text: item.stem, questionId: item.question_id, topicId: item.topic_id, action: "rationale_expand", title: item.topic ?? "Question" })}>
              Explain more with AI
            </Button>
            <Button size="sm" variant="ghost" icon="flag" onClick={() => setReport(item.question_id)}>Report</Button>
          </div>
        )}
      </Card>

      <div className="mt-4 flex items-center justify-between gap-2">
        <Button variant="secondary" icon="chevronLeft" disabled={idx === 0} onClick={() => setIdx((i) => i - 1)}>Previous</Button>
        {idx < items.length - 1 ? (
          <Button onClick={() => setIdx((i) => i + 1)}>Next <Icon name="chevronRight" size={16} /></Button>
        ) : (
          <Button onClick={finish}>Finish session</Button>
        )}
      </div>

      <details className="mt-6">
        <summary className="ink-2 cursor-pointer text-sm font-medium">Jump to a question</summary>
        <div className="mt-3 grid grid-cols-10 gap-1.5">
          {items.map((q, i) => (
            <button key={q.position} onClick={() => setIdx(i)} aria-label={`Question ${i + 1}`}
              className={cx("h-8 rounded-md text-xs font-semibold",
                i === idx ? "ring-2 ring-brand-500" : "",
                q.is_correct === true ? "bg-emerald-500 text-white" : q.is_correct === false ? "bg-red-500 text-white" : "surface-2 border line")}>
              {i + 1}
            </button>
          ))}
        </div>
      </details>
      {report && <ReportDialog open onClose={() => setReport(null)} targetType="question" targetId={report} context={item.stem} />}
    </div>
  );
}
