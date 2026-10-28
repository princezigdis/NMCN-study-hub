import { useEffect, useState } from "react";
import { useAI } from "../../components/ai/AIContext";
import { Badge, Button, Card, cx, DemoBadge, ErrorBox, Input, Loading, Markdown, PageHeader, Textarea, useToast } from "../../components/ui";
import { api } from "../../lib/api";
import { friendly } from "../../lib/errors";
import { clock } from "../../lib/format";
import { useParams } from "../../lib/router";
import type { StationRubric } from "../../lib/types";
import { useAsync } from "../../lib/useAsync";

/** Viva / CAOSCE practice: answer, reveal the marking guide, self-assess, optional AI feedback. */
export default function StationPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const { open } = useAI();
  const { data: s, error, loading, reload } = useAsync(() => api.stationGet(id), [id]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [started, setStarted] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [result, setResult] = useState<{ attempt_id: string; max_score: number; rubric: StationRubric } | null>(null);
  const [ticks, setTicks] = useState<Set<string>>(new Set());
  const [marks, setMarks] = useState<Record<string, number>>({});
  const [score, setScore] = useState<{ self_score: number; max_score: number; critical_missed: number } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!started || result) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [started, result]);

  if (loading) return <Loading />;
  if (error || !s) return <ErrorBox message={error ?? "Station not found"} onRetry={reload} />;

  const left = started ? s.duration_minutes * 60 - (now - started) / 1000 : s.duration_minutes * 60;
  const submit = async () => {
    setBusy(true);
    try { setResult(await api.stationSubmit(id, answers)); } catch (e) { toast(friendly(e), "error"); }
    setBusy(false);
  };
  const selfAssess = async () => {
    if (!result) return;
    setBusy(true);
    try { setScore(await api.stationSelfAssess(result.attempt_id, [...ticks], marks)); } catch (e) { toast(friendly(e), "error"); }
    setBusy(false);
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow={<>{s.kind === "viva" ? "Viva" : "CAOSCE-style"} station {s.is_demo && <DemoBadge />}</>} title={s.title} />
      <div className="mb-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
        Practice only. Feedback here is not an official viva or OSCE assessment.
      </div>

      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">Scenario</h2>
          <span className={cx("rounded-lg px-2 py-1 font-mono text-sm font-bold", left < 60 && started ? "bg-red-600 text-white" : "surface-2")}>{clock(left)}</span>
        </div>
        <Markdown md={s.scenario} />
        {s.candidate_instructions && <p className="ink-2 mt-2 text-sm"><b>Instructions:</b> {s.candidate_instructions}</p>}
        {!started && <Button className="mt-4" onClick={() => setStarted(Date.now())} icon="play">Start station timer</Button>}
      </Card>

      {started && (
        <Card className="mt-4 space-y-4">
          {s.viva_questions.map((q, i) => (
            <div key={q.id}>
              <label htmlFor={q.id} className="mb-1 block text-sm font-semibold">{i + 1}. {q.prompt} <span className="ink-2 font-normal">({q.marks} marks)</span></label>
              <Textarea id={q.id} rows={4} disabled={!!result} value={answers[q.id] ?? ""} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} />
            </div>
          ))}
          {s.checklist_count > 0 && (
            <div>
              <label htmlFor="procedure" className="mb-1 block text-sm font-semibold">Describe, step by step, how you would perform this procedure.</label>
              <Textarea id="procedure" rows={8} disabled={!!result} value={answers.procedure ?? ""} onChange={(e) => setAnswers((a) => ({ ...a, procedure: e.target.value }))} />
            </div>
          )}
          {!result && <Button onClick={submit} loading={busy}>Finish & see marking guide</Button>}
        </Card>
      )}

      {result && (
        <Card className="mt-4 space-y-5">
          <h2 className="font-semibold">Marking guide — assess yourself honestly</h2>
          {result.rubric.viva.map((v) => (
            <div key={v.id} className="rounded-xl border line p-3">
              <div className="text-sm font-semibold">{v.prompt}</div>
              <div className="ink-2 mt-1 text-sm"><b>Expected points:</b> {v.expected_points ?? "—"}</div>
              <div className="mt-2 flex items-center gap-2 text-sm">
                Marks awarded:
                <Input type="number" min={0} max={v.marks} step={0.5} className="w-20" value={marks[v.id] ?? ""}
                  onChange={(e) => setMarks((m) => ({ ...m, [v.id]: Math.min(v.marks, Math.max(0, Number(e.target.value))) }))} />
                / {v.marks}
              </div>
            </div>
          ))}
          {result.rubric.checklist.length > 0 && (
            <div>
              <div className="mb-2 text-sm font-semibold">Procedure checklist: tick the steps you covered</div>
              <ul className="space-y-2">
                {result.rubric.checklist.map((c) => (
                  <li key={c.id}>
                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" className="mt-1" checked={ticks.has(c.id)}
                        onChange={(e) => setTicks((t) => { const n = new Set(t); if (e.target.checked) n.add(c.id); else n.delete(c.id); return n; })} />
                      <span className="flex-1">{c.step}</span>
                      {c.is_critical && <Badge tone="danger">critical</Badge>}
                      <span className="ink-2 text-xs">{c.points} pt</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.rubric.examiner_notes && <p className="ink-2 text-sm"><b>Examiner notes:</b> {result.rubric.examiner_notes}</p>}
          <div className="flex flex-wrap gap-2">
            <Button onClick={selfAssess} loading={busy}>Calculate my score</Button>
            <Button variant="accent" icon="sparkles" onClick={() => open({ kind: "station", text: s.title, stationAttemptId: result.attempt_id, action: "viva_feedback" })}>
              Get AI practice feedback
            </Button>
          </div>
          {score && (
            <div className="rounded-xl bg-brand-50 p-4 dark:bg-brand-900/40">
              <div className="text-2xl font-bold">{score.self_score} / {score.max_score}</div>
              {score.critical_missed > 0 && <p className="mt-1 text-sm font-semibold text-red-700 dark:text-red-300">You missed {score.critical_missed} critical step(s). In a real assessment, missing a critical safety step can mean failing the station.</p>}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
