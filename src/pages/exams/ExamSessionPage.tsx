import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { QuestionCard } from "../../components/QuestionCard";
import { Button, cx, DemoBadge, ErrorBox, Loading, Modal, useToast } from "../../components/ui";
import { api } from "../../lib/api";
import { friendly } from "../../lib/errors";
import { clock } from "../../lib/format";
import { Navigate, useNavigate, useParams } from "../../lib/router";
import type { ExamSessionData } from "../../lib/types";
import { useAsync } from "../../lib/useAsync";

type Pending = Record<number, { option: string | null; flagged: boolean }>;

/** Full-screen exam room. The server owns the clock and the answer key. */
export default function ExamSessionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, error, loading, reload } = useAsync(() => api.examGet(id), [id]);
  const [exam, setExam] = useState<ExamSessionData | null>(null);
  const [idx, setIdx] = useState(0);
  const [remaining, setRemaining] = useState<number>(0);
  const [pending, setPending] = useState<Pending>({});
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const offset = useRef(0);
  const submitted = useRef(false);

  useEffect(() => {
    if (!data) return;
    setExam(data);
    offset.current = new Date(data.server_now).getTime() - Date.now();
    const firstOpen = data.items.findIndex((i) => !i.selected_option_id);
    setIdx(firstOpen === -1 ? 0 : firstOpen);
  }, [data]);

  const submit = useCallback(async (auto = false) => {
    if (submitted.current) return;
    submitted.current = true;
    setSubmitting(true);
    try {
      await api.examSubmit(id);
      if (auto) toast("Time is up — your paper has been submitted.", "info");
      navigate(`/exam/${id}/review`, { replace: true });
    } catch (e) {
      submitted.current = false;
      setSubmitting(false);
      toast(friendly(e), "error");
    }
  }, [id, navigate, toast]);

  // Countdown against the server deadline.
  useEffect(() => {
    if (!exam || exam.attempt.status !== "in_progress") return;
    const deadline = new Date(exam.attempt.deadline_at).getTime();
    const tick = () => {
      const left = (deadline - (Date.now() + offset.current)) / 1000;
      setRemaining(left);
      if (left <= 0) submit(true);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [exam, submit]);

  // Retry unsaved answers (e.g. after a network drop).
  const flush = useCallback(async (queue: Pending) => {
    const entries = Object.entries(queue);
    if (!entries.length) return;
    setSaving(true);
    for (const [pos, v] of entries) {
      try {
        const r = await api.examSave(id, Number(pos), v.option, v.flagged);
        if (r.error === "time_up") { submit(true); return; }
        setPending((p) => { const n = { ...p }; if (n[Number(pos)]?.option === v.option && n[Number(pos)]?.flagged === v.flagged) delete n[Number(pos)]; return n; });
      } catch (e) {
        const msg = friendly(e);
        if (/submitted|closed/i.test(msg)) { navigate(`/exam/${id}/review`, { replace: true }); return; }
      }
    }
    setSaving(false);
  }, [id, navigate, submit]);

  useEffect(() => {
    if (!Object.keys(pending).length) return;
    const t = setTimeout(() => flush(pending), 400);
    return () => clearTimeout(t);
  }, [pending, flush]);

  useEffect(() => {
    const retry = setInterval(() => setPending((p) => ({ ...p })), 8000);
    const warn = (e: BeforeUnloadEvent) => { if (Object.keys(pending).length) { e.preventDefault(); } };
    window.addEventListener("beforeunload", warn);
    return () => { clearInterval(retry); window.removeEventListener("beforeunload", warn); };
  }, [pending]);

  const update = (position: number, patch: { option?: string | null; flagged?: boolean }) => {
    if (!exam) return;
    const item = exam.items.find((i) => i.position === position)!;
    const option = patch.option !== undefined ? patch.option : item.selected_option_id;
    const flagged = patch.flagged !== undefined ? patch.flagged : !!item.flagged;
    setExam({ ...exam, items: exam.items.map((i) => (i.position === position ? { ...i, selected_option_id: option, flagged } : i)) });
    setPending((p) => ({ ...p, [position]: { option, flagged } }));
  };

  // Keyboard: A–E to answer, ←/→ to move, F to flag.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!exam || confirm || (e.target as HTMLElement)?.tagName === "TEXTAREA" || e.metaKey || e.ctrlKey) return;
      const item = exam.items[idx];
      const k = e.key.toUpperCase();
      if (/^[A-E]$/.test(k)) { const o = item.options.find((x) => x.label === k); if (o) update(item.position, { option: o.id }); }
      else if (e.key === "ArrowRight") setIdx((i) => Math.min(i + 1, exam.items.length - 1));
      else if (e.key === "ArrowLeft") setIdx((i) => Math.max(i - 1, 0));
      else if (k === "F") update(item.position, { flagged: !item.flagged });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (loading && !exam) return <Loading label="Opening your exam…" />;
  if (error) return <div className="p-6"><ErrorBox message={error} onRetry={reload} /></div>;
  if (!exam) return null;
  if (exam.attempt.status !== "in_progress") return <Navigate to={`/exam/${id}/review`} />;

  const item = exam.items[idx];
  const answered = exam.items.filter((i) => i.selected_option_id).length;
  const flagged = exam.items.filter((i) => i.flagged).length;
  const unsaved = Object.keys(pending).length;
  const low = remaining < 300;

  return (
    <div className="min-h-screen">
      <header className="surface sticky top-0 z-20 border-b line">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{exam.config.title} · {exam.paper.title} {exam.config.is_demo && <DemoBadge />}</div>
            <div className="ink-2 text-xs">{answered}/{exam.items.length} answered{flagged ? ` · ${flagged} flagged` : ""} ·{" "}
              {unsaved ? (saving ? "Saving…" : <span className="text-amber-600">Offline: will retry</span>) : "All answers saved"}</div>
          </div>
          <div className={cx("rounded-lg px-3 py-1.5 font-mono text-lg font-bold tabular-nums", low ? "bg-red-600 text-white" : "bg-brand-700 text-white")} role="timer" aria-live={low ? "assertive" : "off"}>
            {clock(remaining)}
          </div>
          <Button variant="accent" onClick={() => setConfirm(true)} disabled={submitting}>Submit</Button>
        </div>
      </header>

      <div className="mx-auto grid grid-cols-1 max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[1fr_260px]">
        <div>
          <div className="surface rounded-2xl border line p-5 sm:p-7">
            <QuestionCard item={item} number={idx + 1} total={exam.items.length} selected={item.selected_option_id}
              onSelect={(o) => update(item.position, { option: o })}
              headerRight={
                <button onClick={() => update(item.position, { flagged: !item.flagged })} aria-pressed={!!item.flagged}
                  className={cx("inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold", item.flagged ? "bg-amber-100 text-amber-900" : "ink-2 hover:bg-[var(--surface-2)]")}>
                  <Icon name="flag" size={14} />{item.flagged ? "Flagged" : "Flag"}
                </button>
              } />
            {item.selected_option_id && (
              <button className="ink-2 mt-3 text-xs underline" onClick={() => update(item.position, { option: null })}>Clear my answer</button>
            )}
          </div>
          <div className="mt-4 flex justify-between">
            <Button variant="secondary" icon="chevronLeft" disabled={idx === 0} onClick={() => setIdx((i) => i - 1)}>Previous</Button>
            {idx < exam.items.length - 1
              ? <Button onClick={() => setIdx((i) => i + 1)}>Next <Icon name="chevronRight" size={16} /></Button>
              : <Button variant="accent" onClick={() => setConfirm(true)}>Review & submit</Button>}
          </div>
          <p className="ink-2 mt-4 hidden text-xs sm:block">Shortcuts: A–E answer · ← → move · F flag</p>
        </div>

        <aside className="surface h-fit rounded-2xl border line p-4 lg:sticky lg:top-20">
          <div className="mb-2 text-sm font-semibold">Questions</div>
          <div className="grid grid-cols-8 gap-1.5 lg:grid-cols-6">
            {exam.items.map((q, i) => (
              <button key={q.position} onClick={() => setIdx(i)} aria-label={`Question ${i + 1}${q.selected_option_id ? ", answered" : ""}${q.flagged ? ", flagged" : ""}`}
                className={cx("relative h-8 rounded-md text-xs font-semibold",
                  i === idx && "ring-2 ring-brand-500",
                  q.selected_option_id ? "bg-brand-600 text-white" : "surface-2 border line")}>
                {i + 1}
                {q.flagged && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-accent-500" />}
              </button>
            ))}
          </div>
          <div className="ink-2 mt-3 flex flex-wrap gap-3 text-xs">
            <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-brand-600" />Answered</span>
            <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-accent-500" />Flagged</span>
          </div>
        </aside>
      </div>

      <Modal open={confirm} onClose={() => setConfirm(false)} title="Submit this paper?"
        footer={<><Button variant="secondary" onClick={() => setConfirm(false)}>Keep working</Button><Button onClick={() => submit(false)} loading={submitting}>Submit paper</Button></>}>
        <div className="space-y-2 text-sm">
          <p>You've answered <b>{answered}</b> of <b>{exam.items.length}</b> questions.</p>
          {exam.items.length - answered > 0 && <p className="text-amber-700 dark:text-amber-300">{exam.items.length - answered} unanswered question(s) will be marked wrong.</p>}
          {flagged > 0 && <p>{flagged} question(s) are flagged for review.</p>}
          {unsaved > 0 && <p className="text-red-600">Some answers haven't reached the server yet. Wait for "All answers saved" if you can.</p>}
          <p className="ink-2">You can't change answers after submitting.</p>
        </div>
      </Modal>
    </div>
  );
}
