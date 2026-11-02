import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "../../lib/router";
import { useAsync } from "../../lib/useAsync";
import { friendly } from "../../lib/errors";
import { viva, tone, type J } from "../../lib/lab";
import { mmss, speak, speakSupported, speechSupported, stopSpeaking, useCountdown, useDictation } from "../../lib/speech";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Loading, PageHeader, ProgressBar, Select, Stat, Tabs, Textarea, useToast } from "../../components/ui";
import { Icon } from "../../components/Icon";

const MODES = [
  { id: "learning", label: "Learning", hint: "Guide and feedback after every answer" },
  { id: "practice", label: "Practice", hint: "Feedback after every answer, you can claim points" },
  { id: "weakness", label: "My weak topics", hint: "Questions you missed before" },
];


// ---------------------------------------------------------------- Home
export function VivaHomePage() {
  const nav = useNavigate();
  const toast = useToast();
  const home = useAsync(() => viva.home(), []);
  const ex = useAsync(() => viva.examiners(), []);
  const cases = useAsync(() => viva.cases(), []);
  const [mode, setMode] = useState("practice");
  const [cat, setCat] = useState("");
  const [count, setCount] = useState(5);
  const [style, setStyle] = useState("friendly");
  const [busy, setBusy] = useState(false);

  const start = async (caseId?: string) => {
    setBusy(true);
    try {
      const id = await viva.start({ mode, category: cat || null, count, style, caseId: caseId ?? null });
      nav(`/viva/session/${id}`);
    } catch (e) {
      const msg = friendly(e);
      if (msg.includes("unlocked")) nav("/plans"); else toast(msg, "error");
    } finally { setBusy(false); }
  };

  if (home.loading) return <Loading />;
  if (home.error || !home.data) return <ErrorBox message={home.error ?? "Could not load."} onRetry={home.reload} />;
  const h: J = home.data;
  return (
    <div>
      <PageHeader eyebrow="Oral examination practice" title="Viva Lab"
        subtitle="Practice area. Answer examiner-style questions in your own words, by voice or typing, and see the marking guide. The full timed viva exam is in Paper 4 of Section C and D."
        actions={<><Link to="/viva/progress"><Button variant="secondary" icon="chart">My progress</Button></Link><Link to="/caosce"><Button variant="secondary" icon="clipboard">CAOSCE Lab</Button></Link></>} />
      {!h.programme && <Card className="mb-4"><p className="text-sm">Choose RN or RM in your <Link to="/profile" className="underline">profile</Link> to see questions for your programme.</p></Card>}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Sessions" value={h.stats.sessions} />
        <Stat label="Completed" value={h.stats.completed} />
        <Stat label="Average" value={h.stats.avg_percent != null ? `${h.stats.avg_percent}%` : "-"} />
        <Stat label="Best" value={h.stats.best_percent != null ? `${h.stats.best_percent}%` : "-"} />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="mb-3 text-lg font-semibold">Start a viva</h2>
          <Tabs tabs={MODES.map((m) => ({ id: m.id, label: m.label }))} value={mode} onChange={setMode} />
          <p className="ink-2 mb-3 mt-2 text-sm">{MODES.find((m) => m.id === mode)?.hint}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Topic">{(id) => (
              <Select id={id} value={cat} onChange={(e) => setCat(e.target.value)} disabled={mode === "weakness"}>
                <option value="">All topics</option>
                {h.categories.filter((c: J) => c.cases > 0).map((c: J) => <option key={c.id} value={c.id}>{c.name} ({c.cases})</option>)}
              </Select>)}</Field>
            <Field label="Questions">{(id) => (
              <Select id={id} value={count} onChange={(e) => setCount(Number(e.target.value))}>
                {[3, 5, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}</Select>)}</Field>
            <Field label="Examiner">{(id) => (
              <Select id={id} value={style} onChange={(e) => setStyle(e.target.value)}>
                {(ex.data ?? [{ style: "friendly", label: "Friendly examiner" }]).map((x: J) => <option key={x.style} value={x.style}>{x.label}</option>)}</Select>)}</Field>
          </div>
          <Button className="mt-4" size="lg" icon="play" loading={busy} onClick={() => start()}>Begin viva</Button>
        </Card>
        <Card>
          <h2 className="mb-2 text-lg font-semibold">Case of the day</h2>
          {h.daily ? (<>
            <div className="font-medium">{h.daily.title}</div>
            <div className="ink-2 mb-3 text-sm">{h.daily.category}</div>
            <Button variant="accent" onClick={() => start(h.daily.id)} loading={busy}>Try this case</Button>
          </>) : <p className="ink-2 text-sm">No cases are published yet.</p>}
          {h.recent.length > 0 && <div className="mt-5"><div className="mb-1 text-sm font-semibold">Recent</div>
            {h.recent.map((r: J) => <Link key={r.id} to={r.status === "in_progress" ? `/viva/session/${r.id}` : `/viva/report/${r.id}`} className="flex justify-between py-1 text-sm hover:underline">
              <span>{r.mode}</span><span className="ink-2">{r.status === "in_progress" ? "Continue" : r.percent != null ? `${r.percent}%` : r.status}</span></Link>)}</div>}
        </Card>
      </div>
      <h2 className="mb-3 mt-8 text-lg font-semibold">Cases</h2>
      {cases.loading ? <Loading /> : (cases.data ?? []).length === 0 ? <EmptyState icon="quiz" title="No cases published yet">Your tutors are still reviewing the first set. Check back soon.</EmptyState> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(cases.data ?? []).map((c: J) => (
            <Card key={c.id}>
              <div className="mb-1 flex items-center gap-2"><Badge>{c.category}</Badge>{c.free && <Badge tone="success">Free</Badge>}{c.locked && <Badge tone="warning">Locked</Badge>}</div>
              <div className="font-medium">{c.title}</div>
              <div className="ink-2 mt-1 text-sm">{c.questions} questions · {c.difficulty}{c.best_percent != null ? ` · best ${c.best_percent}%` : ""}</div>
              <Button size="sm" variant="secondary" className="mt-3" onClick={() => start(c.id)} disabled={busy}>Practise</Button>
            </Card>))}
        </div>)}
    </div>
  );
}

// ---------------------------------------------------------------- Session
function ResultView({ r, mode, onAdjust }: { r: J; mode: string; onAdjust: (ids: string[]) => void }) {
  const [sel, setSel] = useState<string[]>(r.self_points ?? []);
  const canClaim = mode !== "mock";
  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center gap-3">
        <Badge tone={tone(r.max ? (100 * r.score) / r.max : 0)}>{r.score} / {r.max} marks</Badge>
        {r.flags?.length > 0 && <Badge tone="danger">Unsafe statement flagged</Badge>}
      </div>
      {r.flags?.map((f: J, i: number) => <p key={i} className="rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">Check this: your answer may suggest an unsafe action ("{f.text}"). Review the marking guide below.</p>)}
      <div>
        <div className="mb-1 text-sm font-semibold">Marking guide: key points</div>
        <ul className="space-y-1.5">
          {r.points.map((p: J) => (
            <li key={p.id} className="flex items-start gap-2 text-sm">
              <span className={p.status === "hit" || sel.includes(p.id) ? "text-green-600" : p.status === "partial" ? "text-amber-600" : "text-red-600"}>
                <Icon name={p.status === "hit" || sel.includes(p.id) ? "check" : p.status === "partial" ? "info" : "x"} size={16} /></span>
              <span className="flex-1">{p.point}{p.is_critical && <Badge tone="danger" className="ml-2">Critical</Badge>}
                {p.status === "partial" && <span className="ink-2"> (partly covered)</span>}</span>
              {canClaim && p.status !== "hit" && (
                <label className="ink-2 flex shrink-0 items-center gap-1 text-xs">
                  <input type="checkbox" checked={sel.includes(p.id)} onChange={(e) => setSel(e.target.checked ? [...sel, p.id] : sel.filter((x) => x !== p.id))} />
                  I said this in my own words</label>)}
            </li>))}
        </ul>
        {canClaim && r.points.some((p: J) => p.status !== "hit") && (
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => onAdjust(sel)}>Update my marks</Button>)}
        <p className="ink-2 mt-1 text-xs">Different English is welcome. If you meant the point, tick it and your mark is adjusted.</p>
      </div>
      {r.model_answer && <div><div className="mb-1 text-sm font-semibold">Model answer</div><p className="surface-2 rounded-lg p-3 text-sm">{r.model_answer}</p></div>}
      {r.explanation && <div><div className="mb-1 text-sm font-semibold">Why this matters</div><p className="text-sm">{r.explanation}</p></div>}
    </div>
  );
}

export function VivaSessionPage() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const toast = useToast();
  const att = useAsync(() => viva.get(id), [id]);
  const [idx, setIdx] = useState<number | null>(null);
  const [answer, setAnswer] = useState("");
  const [source, setSource] = useState<"text" | "voice">("text");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Record<string, J>>({});
  const [voice, setVoice] = useState(false);
  const [spoken, setSpoken] = useState(true);
  const dict = useDictation(useCallback((t: string) => { setAnswer(t); setSource("voice"); }, []));
  const a: J = att.data;
  const left = useCountdown(a?.deadline_at, a?.server_now);

  useEffect(() => {
    if (a && idx === null) {
      const first = a.items.findIndex((i: J) => !i.answered);
      setIdx(first === -1 ? a.items.length - 1 : first);
      const rs: Record<string, J> = {};
      a.items.forEach((i: J) => { if (i.result) rs[i.id] = i.result; });
      setResults(rs);
    }
  }, [a, idx]);
  const item: J = a && idx !== null ? a.items[idx] : null;
  useEffect(() => { stopSpeaking(); dict.stop(); setAnswer(""); setSource("text"); if (item && voice && spoken && !results[item.id]) speak(item.prompt); /* eslint-disable-next-line */ }, [item?.id]);
  useEffect(() => () => { stopSpeaking(); }, []);

  const finish = useCallback(async () => {
    try { await viva.finish(id); } catch (e) { toast(friendly(e), "error"); }
    nav(`/viva/report/${id}`);
  }, [id, nav, toast]);
  useEffect(() => { if (left === 0 && a?.mode === "mock" && a.status === "in_progress") { toast("Time is up.", "info"); void finish(); } /* eslint-disable-next-line */ }, [left]);
  useEffect(() => { if (a && a.status !== "in_progress") nav(`/viva/report/${id}`); }, [a, id, nav]);

  if (att.loading || !a || idx === null) return att.error ? <ErrorBox message={att.error} onRetry={att.reload} /> : <Loading />;
  if (!item) return <ErrorBox message="This session has no questions." />;
  const res = results[item.id];
  const mock = a.mode === "mock";
  const answeredMock = mock && item.answered;
  const last = idx === a.items.length - 1;

  const submit = async () => {
    dict.stop(); setBusy(true);
    try {
      const r = await viva.answer(id, item.id, answer, source);
      if (mock) { item.answered = true; } else setResults({ ...results, [item.id]: r });
      if (mock) { if (last) await finish(); else { setIdx(idx + 1); } }
    } catch (e) { toast(friendly(e), "error"); } finally { setBusy(false); }
  };
  const adjust = async (ids: string[]) => {
    try { const r = await viva.selfAdjust(res.response_id, ids); setResults({ ...results, [item.id]: r }); toast("Marks updated.", "success"); }
    catch (e) { toast(friendly(e), "error"); }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div><Badge tone="brand">{a.examiner.label}</Badge> <span className="ink-2 ml-2 text-sm">Question {idx + 1} of {a.items.length}</span></div>
        <div className="flex items-center gap-2">
          {left != null && <Badge tone={left < 60 ? "danger" : "neutral"}>{mmss(left)}</Badge>}
          <Button size="sm" variant="ghost" onClick={finish}>End session</Button>
        </div>
      </div>
      <ProgressBar value={idx + (res || answeredMock ? 1 : 0)} max={a.items.length} />
      {idx === 0 && !res && <p className="ink-2 mt-3 text-sm italic">"{a.examiner.intro}"</p>}
      <Card className="mt-4">
        {item.case_intro && <div className="surface-2 mb-4 rounded-lg p-3 text-sm"><div className="mb-1 font-semibold">{item.case_title}</div>{item.case_intro}</div>}
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold">{item.prompt}</h2>
          {speakSupported && <Button size="sm" variant="ghost" aria-label="Read the question aloud" onClick={() => speak(item.prompt)}><Icon name="volume" size={18} /></Button>}
        </div>
        <div className="ink-2 text-xs">{item.marks} marks</div>
        {!res ? (<>
          <div className="mt-4"><Textarea rows={6} value={answer} onChange={(e) => { setAnswer(e.target.value); }} placeholder="Answer in your own words. Say it the way you would explain it to the examiner." aria-label="Your answer" /></div>
          {voice && <p className="ink-2 mt-1 text-xs">Your browser turns your speech into text. Check the words below before you submit. We do not store your audio.</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {speechSupported ? (voice ? (
              dict.listening ? <Button variant="danger" icon="mic" onClick={dict.stop}>Stop recording</Button>
                : <Button variant="secondary" icon="mic" onClick={() => dict.start(answer)}>{answer ? "Record more" : "Speak my answer"}</Button>)
              : <Button variant="secondary" icon="mic" onClick={() => setVoice(true)}>Use voice</Button>)
              : <span className="ink-2 text-xs">Voice is not supported in this browser. Type your answer.</span>}
            {voice && <label className="ink-2 flex items-center gap-1 text-xs"><input type="checkbox" checked={spoken} onChange={(e) => setSpoken(e.target.checked)} />Read questions aloud</label>}
            <div className="flex-1" />
            <Button onClick={submit} loading={busy} disabled={answer.trim().length < 2}>{mock && !last ? "Submit and next" : mock ? "Submit and finish" : "Submit answer"}</Button>
          </div>
          {dict.error && <p className="mt-2 text-sm text-red-600">{dict.error}</p>}
        </>) : (<>
          <div className="surface-2 mt-4 rounded-lg p-3 text-sm"><div className="ink-2 mb-1 text-xs">Your answer</div>{res.answer}</div>
          <ResultView r={res} mode={a.mode} onAdjust={adjust} />
          <div className="mt-5 flex justify-end">
            {last ? <Button onClick={finish}>See my report</Button> : <Button onClick={() => setIdx(idx + 1)}>Next question</Button>}
          </div>
        </>)}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- Report
export function VivaReportPage() {
  const { id } = useParams<{ id: string }>();
  const rep = useAsync(() => viva.report(id), [id]);
  if (rep.loading) return <Loading />;
  if (rep.error || !rep.data) return <ErrorBox message={rep.error ?? "Could not load."} onRetry={rep.reload} />;
  const r: J = rep.data;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="Viva report" title={`${r.percent ?? 0}%`} subtitle={`${r.score} of ${r.max_score} marks · ${r.mode} mode`}
        actions={<Link to="/viva"><Button>Practise again</Button></Link>} />
      {r.critical_missed > 0 && <Card className="mb-4 border-red-300"><p className="text-sm font-medium text-red-700 dark:text-red-300">You missed {r.critical_missed} critical point{r.critical_missed > 1 ? "s" : ""}. In a real exam these are safety-related, so revise them first.</p></Card>}
      {r.revise?.length > 0 && <Card className="mb-4"><h2 className="mb-2 font-semibold">Points to revise</h2><ul className="list-disc space-y-1 pl-5 text-sm">{r.revise.map((p: string, i: number) => <li key={i}>{p}</li>)}</ul></Card>}
      <div className="space-y-4">
        {r.items.map((it: J, i: number) => (
          <Card key={it.id}>
            <div className="flex justify-between gap-2"><h3 className="font-medium">{i + 1}. {it.prompt}</h3>
              {it.result ? <Badge tone={tone(100 * it.result.score / it.result.max)}>{it.result.score}/{it.result.max}</Badge> : <Badge>Not answered</Badge>}</div>
            {it.result && <ResultView r={it.result} mode="mock" onAdjust={() => undefined} />}
          </Card>))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Progress
export function VivaProgressPage() {
  const p = useAsync(() => viva.progress(), []);
  if (p.loading) return <Loading />;
  if (p.error || !p.data) return <ErrorBox message={p.error ?? "Could not load."} onRetry={p.reload} />;
  const d: J = p.data;
  return (
    <div>
      <PageHeader eyebrow="Viva Lab" title="My progress" actions={<Link to="/viva"><Button variant="secondary">Back</Button></Link>} />
      {d.by_category.length === 0 ? <EmptyState icon="chart" title="No answers yet">Complete a viva session to see your progress by topic.</EmptyState> : (
        <Card><h2 className="mb-3 font-semibold">By topic (weakest first)</h2>
          <div className="space-y-3">{d.by_category.map((c: J) => (
            <div key={c.category}><div className="mb-1 flex justify-between text-sm"><span>{c.category}</span><span className="ink-2">{c.percent}% · {c.answered} answers</span></div>
              <ProgressBar value={c.percent ?? 0} tone={c.percent < 50 ? "danger" : "brand"} /></div>))}</div></Card>)}
      {d.trend.length > 1 && <Card className="mt-4"><h2 className="mb-2 font-semibold">Recent scores</h2>
        <div className="flex h-28 items-end gap-2">{d.trend.map((t: J, i: number) => <div key={i} className="flex-1 text-center text-xs" title={`${t.date}: ${t.percent}%`}>
          <div className="mx-auto w-full max-w-8 rounded-t bg-brand-600" style={{ height: `${Math.max(4, t.percent)}%` }} /><div className="ink-2 mt-1">{t.percent}</div></div>)}</div></Card>}
    </div>
  );
}
