import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "../../lib/router";
import { useAsync } from "../../lib/useAsync";
import { friendly } from "../../lib/errors";
import { supabase } from "../../lib/supabase";
import { caosce, tone, type J } from "../../lib/lab";
import { mmss, useCountdown } from "../../lib/speech";
import { Badge, Button, Card, EmptyState, ErrorBox, Input, Loading, PageHeader, ProgressBar, Select, Stat, Tabs, Textarea, useToast } from "../../components/ui";
import { Icon } from "../../components/Icon";

const DISCLAIMER = "Practice tool for revision. It is not an official NMCN CAOSCE, and passing here does not guarantee any examination result. Content is reviewed by tutors but always follow your school's approved procedure manual.";
const Disclaimer = () => <p className="ink-2 mt-6 text-xs">{DISCLAIMER}</p>;

function Back({ to, label = "Back" }: { to: string; label?: string }) {
  return <Link to={to} className="ink-2 mb-3 inline-flex items-center gap-1 text-sm hover:underline"><Icon name="chevronLeft" size={16} />{label}</Link>;
}

// ---------------------------------------------------------------- Home
export function CaosceHomePage() {
  const h = useAsync(() => caosce.home(), []);
  if (h.loading) return <Loading />;
  if (h.error || !h.data) return <ErrorBox message={h.error ?? "Could not load."} onRetry={h.reload} />;
  const d: J = h.data;
  const tiles = [
    { to: "/caosce/library", icon: "book", title: "Procedure library", text: "Learn each procedure in seven stages." },
    { to: "/caosce/lab", icon: "activity", title: "Virtual skills lab", text: "Sequencing, equipment, mistakes and decisions." },
    { to: "/caosce/questions", icon: "quiz", title: "Question stations", text: "Practise short questions on procedures." },
    { to: "/caosce/exams", icon: "clipboard", title: "Mock CAOSCE", text: "Timed stations marked against a checklist." },
    { to: "/caosce/dashboard", icon: "chart", title: "My progress", text: "See your weak procedures and missed steps." },
    { to: "/viva", icon: "mic", title: "Viva Lab", text: "Oral questions in your own words." },
  ];
  return (
    <div>
      <PageHeader eyebrow="Clinical skills practice" title="CAOSCE Lab" subtitle="Learn procedures step by step, practise in a virtual lab, then sit timed stations." />
      {!d.programme && <Card className="mb-4"><p className="text-sm">Choose RN or RM in your <Link to="/profile" className="underline">profile</Link> to see procedures for your programme.</p></Card>}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Procedures" value={d.counts.procedures} /><Stat label="Studied" value={d.studied} />
        <Stat label="Videos" value={d.counts.videos} /><Stat label="Mock exams" value={d.counts.exams} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((t) => <Link key={t.to} to={t.to}><Card className="h-full transition-shadow hover:shadow-md"><Icon name={t.icon as never} className="mb-2 text-brand-600" /><div className="font-semibold">{t.title}</div><div className="ink-2 text-sm">{t.text}</div></Card></Link>)}
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {d.daily && <Card><h2 className="mb-1 font-semibold">Procedure of the day</h2><div>{d.daily.name}</div>
          <Link to={`/caosce/procedure/${d.daily.id}`}><Button className="mt-3" variant="accent">{d.daily.locked ? "View (locked)" : "Study it"}</Button></Link></Card>}
        {d.recommended.length > 0 && <Card><h2 className="mb-2 font-semibold">Recommended next</h2>
          {d.recommended.map((r: J) => <Link key={r.id} to={`/caosce/procedure/${r.id}`} className="flex justify-between py-1 text-sm hover:underline"><span>{r.name}</span>{r.locked && <Icon name="lock" size={14} />}</Link>)}</Card>}
      </div>
      {!d.has_access && <Card className="mt-4"><p className="text-sm">Free preview procedures are open to everyone. <Link to="/plans" className="underline">Unlock Section C/D</Link> for the whole lab.</p></Card>}
      <Disclaimer />
    </div>
  );
}

// ---------------------------------------------------------------- Library
export function CaosceLibraryPage() {
  const cats = useAsync(() => caosce.categories(), []);
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");
  const [qs, setQs] = useState("");
  useEffect(() => { const t = window.setTimeout(() => setQs(q), 300); return () => window.clearTimeout(t); }, [q]);
  const lib = useAsync(() => caosce.library(cat || null, qs), [cat, qs]);
  return (
    <div>
      <Back to="/caosce" label="CAOSCE Lab" />
      <PageHeader title="Procedure library" subtitle="Each procedure has seven learning stages." />
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Input placeholder="Search procedures" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search procedures" />
        <Select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category"><option value="">All categories</option>{(cats.data ?? []).map((c: J) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
      </div>
      {lib.loading ? <Loading /> : lib.error ? <ErrorBox message={lib.error} onRetry={lib.reload} /> : (lib.data ?? []).length === 0 ? <EmptyState icon="book" title="No procedures found">Try another search, or check back when more are published.</EmptyState> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(lib.data ?? []).map((p: J) => (
            <Link key={p.id} to={`/caosce/procedure/${p.id}`}><Card className="h-full hover:shadow-md">
              <div className="mb-1 flex flex-wrap gap-1">{p.category && <Badge>{p.category}</Badge>}<Badge tone="info">{p.programme}</Badge>{p.free && <Badge tone="success">Free</Badge>}{p.locked && <Badge tone="warning">Locked</Badge>}</div>
              <div className="font-medium">{p.name}</div>
              <div className="ink-2 mt-1 text-sm">{p.steps} steps · {p.videos} videos</div>
              <div className="mt-3"><ProgressBar value={p.stages_done} max={7} label={`${p.stages_done} of 7 stages`} /></div>
            </Card></Link>))}
        </div>)}
    </div>
  );
}

// ---------------------------------------------------------------- Video player
function VideoPlayer({ videoId, onWatched }: { videoId: string; onWatched: () => void }) {
  const v = useAsync(() => caosce.video(videoId), [videoId]);
  const [url, setUrl] = useState<string | null>(null);
  const [cap, setCap] = useState<string | null>(null);
  const last = useRef(0);
  useEffect(() => {
    const d: J = v.data; if (!d) return;
    if (d.external_url) { setUrl(d.external_url); return; }
    if (d.storage_path) {
      void supabase.storage.from("lab-media").createSignedUrl(d.storage_path, 3600).then(({ data }) => setUrl(data?.signedUrl ?? null));
      if (d.captions_path) void supabase.storage.from("lab-media").createSignedUrl(d.captions_path, 3600).then(({ data }) => setCap(data?.signedUrl ?? null));
    }
  }, [v.data]);
  if (v.loading) return <Loading />;
  if (v.error || !v.data) return <ErrorBox message={v.error ?? "Video unavailable"} onRetry={v.reload} />;
  const d: J = v.data;
  const embed = d.external_url && /youtube\.com|youtu\.be|vimeo\.com/.test(d.external_url);
  return (
    <div>
      {!url ? <p className="ink-2 text-sm">Preparing video…</p> : embed ? (
        <div className="aspect-video overflow-hidden rounded-xl"><iframe src={url.replace("watch?v=", "embed/")} title={d.title} className="h-full w-full" allowFullScreen /></div>
      ) : (
        <video src={url} controls className="w-full rounded-xl bg-black" crossOrigin="anonymous"
          onLoadedMetadata={(e) => { if (d.position_seconds > 5) e.currentTarget.currentTime = d.position_seconds; }}
          onTimeUpdate={(e) => { const t = e.currentTarget.currentTime; if (t - last.current > 15) { last.current = t; void caosce.videoProgress(videoId, t).catch(() => undefined); } }}
          onEnded={(e) => { void caosce.videoProgress(videoId, e.currentTarget.duration, true).catch(() => undefined); onWatched(); }}>
          {cap && <track kind="captions" src={cap} srcLang="en" label="English" default />}
        </video>)}
      {d.description && <p className="mt-2 text-sm">{d.description}</p>}
      {Array.isArray(d.chapters) && d.chapters.length > 0 && <ul className="ink-2 mt-2 text-sm">{d.chapters.map((c: J, i: number) => <li key={i}>{mmss(c.at ?? c.seconds ?? 0)} {c.title}</li>)}</ul>}
      {d.transcript && <details className="mt-2"><summary className="cursor-pointer text-sm font-medium">Transcript</summary><p className="mt-1 whitespace-pre-wrap text-sm">{d.transcript}</p></details>}
    </div>
  );
}

// ---------------------------------------------------------------- Exercises (shared)
function PickExercise({ id, onDone }: { id: string; onDone?: () => void }) {
  const ex = useAsync(() => caosce.exercise(id), [id]);
  const [sel, setSel] = useState<string[]>([]);
  const [res, setRes] = useState<J>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  if (ex.loading) return <Loading />;
  if (ex.error || !ex.data) return <ErrorBox message={ex.error ?? "Not available"} onRetry={ex.reload} />;
  const e: J = ex.data;
  const toggle = (oid: string) => setSel(e.multi ? (sel.includes(oid) ? sel.filter((x) => x !== oid) : [...sel, oid]) : [oid]);
  const check = async () => { setBusy(true); try { setRes(await caosce.exerciseCheck(id, sel)); onDone?.(); } catch (er) { toast(friendly(er), "error"); } finally { setBusy(false); } };
  return (
    <Card>
      <Badge tone="brand">{e.kind === "mistake" ? "Spot the mistake" : "Clinical decision"}</Badge>
      <h3 className="mt-2 font-semibold">{e.title}</h3>
      <p className="mt-1 text-sm">{e.scenario}</p>
      <p className="ink-2 mt-1 text-xs">{e.multi ? "Select all that apply." : "Choose one."}</p>
      <div className="mt-3 space-y-2">
        {(res ? res.options : e.options).map((o: J) => (
          <label key={o.id} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm line ${res ? (o.correct ? "border-green-500 bg-green-50 dark:bg-green-950" : o.selected ? "border-red-400 bg-red-50 dark:bg-red-950" : "") : sel.includes(o.id) ? "border-brand-600" : ""}`}>
            <input type={e.multi ? "checkbox" : "radio"} disabled={!!res} checked={res ? o.selected : sel.includes(o.id)} onChange={() => toggle(o.id)} />
            <span className="flex-1">{o.text}{res && (o.selected || o.correct) && o.feedback && <span className="ink-2 mt-1 block text-xs">{o.feedback}</span>}</span>
          </label>))}
      </div>
      {!res ? <Button className="mt-3" onClick={check} loading={busy} disabled={sel.length === 0}>Check</Button> : (
        <div className="mt-3 text-sm"><Badge tone={tone(res.score * 100)}>{Math.round(res.score * 100)}%</Badge> {res.explanation}</div>)}
    </Card>
  );
}

function SequenceExercise({ p, onDone }: { p: J; onDone: () => void }) {
  const toast = useToast();
  const [order, setOrder] = useState<J[]>(() => [...p.steps].sort(() => Math.random() - 0.5));
  const [res, setRes] = useState<J>(null);
  const move = (i: number, d: number) => { const j = i + d; if (j < 0 || j >= order.length) return; const n = [...order]; [n[i], n[j]] = [n[j], n[i]]; setOrder(n); };
  const check = async () => { try { setRes(await caosce.sequenceCheck(p.id, order.map((s) => s.id))); onDone(); } catch (e) { toast(friendly(e), "error"); } };
  return (
    <Card>
      <Badge tone="brand">Put the steps in order</Badge>
      {!res ? (<>
        <ol className="mt-3 space-y-2">{order.map((s, i) => (
          <li key={s.id} className="surface-2 flex items-center gap-2 rounded-lg p-2 text-sm"><span className="ink-2 w-6 text-center">{i + 1}</span><span className="flex-1">{s.action}</span>
            <Button size="sm" variant="ghost" aria-label="Move up" onClick={() => move(i, -1)}><Icon name="arrowUp" size={16} /></Button>
            <Button size="sm" variant="ghost" aria-label="Move down" onClick={() => move(i, 1)}><Icon name="arrowDown" size={16} /></Button></li>))}</ol>
        <Button className="mt-3" onClick={check}>Check order</Button></>) : (
        <div className="mt-3"><Badge tone={tone(res.score * 100)}>{res.correct_positions} of {res.total} in the right place</Badge>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">{res.correct_order.map((s: J) => <li key={s.id} className={s.your_position === res.correct_order.indexOf(s) + 1 ? "" : "text-red-700 dark:text-red-300"}>{s.action}{s.rationale && <span className="ink-2"> — {s.rationale}</span>}</li>)}</ol></div>)}
    </Card>
  );
}

function EquipmentExercise({ p, onDone }: { p: J; onDone: () => void }) {
  const toast = useToast();
  const [sel, setSel] = useState<string[]>([]);
  const [res, setRes] = useState<J>(null);
  const check = async () => { try { setRes(await caosce.equipmentCheck(p.id, sel)); onDone(); } catch (e) { toast(friendly(e), "error"); } };
  return (
    <Card>
      <Badge tone="brand">Choose the equipment</Badge>
      <p className="mt-2 text-sm">Select everything you need for <b>{p.name}</b>.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">{p.candidates.map((c: J) => (
        <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-sm line"><input type="checkbox" disabled={!!res} checked={sel.includes(c.id)} onChange={(e) => setSel(e.target.checked ? [...sel, c.id] : sel.filter((x) => x !== c.id))} />{c.name}</label>))}</div>
      {!res ? <Button className="mt-3" onClick={check} disabled={!sel.length}>Check</Button> : (
        <div className="mt-3 space-y-1 text-sm"><Badge tone={tone(res.score * 100)}>{Math.round(res.score * 100)}%</Badge>
          {res.missed?.length > 0 && <p><b>You missed:</b> {res.missed.map((m: J) => `${m.name} (${m.purpose ?? ""})`).join("; ")}</p>}
          {res.wrong_items?.length > 0 && <p><b>Not needed:</b> {res.wrong_items.map((m: J) => m.name).join(", ")}</p>}</div>)}
    </Card>
  );
}

function RationaleExercise({ step }: { step: J }) {
  const toast = useToast();
  const [ans, setAns] = useState("");
  const [res, setRes] = useState<J>(null);
  const check = async () => { try { setRes(await caosce.rationaleCheck(step.id, ans)); } catch (e) { toast(friendly(e), "error"); } };
  return (
    <div className="mt-3 rounded-lg border p-3 line">
      <div className="text-sm font-medium">Why do we do this? Explain in your own words.</div>
      <Textarea rows={2} value={ans} onChange={(e) => setAns(e.target.value)} className="mt-1" />
      {!res ? <Button size="sm" className="mt-2" onClick={check} disabled={ans.trim().length < 3}>Check my reasoning</Button> : (
        <div className="mt-2 text-sm"><Badge tone={tone(res.score * 100)}>{res.verdict}</Badge><p className="mt-1"><b>Reference reasoning:</b> {res.rationale}</p></div>)}
    </div>
  );
}

// ---------------------------------------------------------------- Procedure (7 stages)
const STAGES = [
  { id: "understand", label: "1 Understand" }, { id: "equipment", label: "2 Equipment" }, { id: "prepare", label: "3 Prepare" },
  { id: "video", label: "4 Watch" }, { id: "steps", label: "5 Steps" }, { id: "station", label: "6 Practise" }, { id: "results", label: "7 Results" },
];
const List = ({ title, items }: { title: string; items?: string[] }) => items && items.length ? <div className="mb-4"><h3 className="mb-1 font-semibold">{title}</h3><ul className="list-disc space-y-0.5 pl-5 text-sm">{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div> : null;

export function CaosceProcedurePage() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const p = useAsync(() => caosce.procedure(id), [id]);
  const [stage, setStage] = useState("understand");
  const [done, setDone] = useState<string[]>([]);
  const [know, setKnow] = useState<string[]>([]);
  const [vid, setVid] = useState<string | null>(null);
  const toast = useToast();
  useEffect(() => { if (p.data) { setDone(p.data.progress.stages_done ?? []); setKnow(p.data.progress.steps_understood ?? []); } }, [p.data]);
  const mark = useCallback(async (s: string, step?: string) => {
    try { await caosce.mark(id, s, step); setDone((d) => (d.includes(s) ? d : [...d, s])); if (step) setKnow((k) => (k.includes(step) ? k : [...k, step])); } catch (e) { toast(friendly(e), "error"); }
  }, [id, toast]);
  if (p.loading) return <Loading />;
  if (p.error || !p.data) {
    if (p.error?.includes("unlocked")) return <EmptyState icon="lock" title="This procedure is locked" action={<Link to="/plans"><Button>See plans</Button></Link>}>Free preview procedures are open to everyone. Unlock Section C/D for all procedures.</EmptyState>;
    return <ErrorBox message={p.error ?? "Not available"} onRetry={p.reload} />;
  }
  const d: J = p.data;
  const stageDone = (s: string) => done.includes(s);
  const MarkBtn = ({ s }: { s: string }) => stageDone(s) ? <Badge tone="success">Stage complete</Badge> : <Button variant="secondary" size="sm" onClick={() => mark(s)}>Mark stage complete</Button>;
  const pp: J = d.patient_prep ?? {};
  return (
    <div>
      <Back to="/caosce/library" label="Library" />
      <PageHeader eyebrow={d.code} title={d.name} subtitle={d.description}
        actions={d.status !== "published" ? <Badge tone="warning">Preview: not published</Badge> : undefined} />
      <div className="mb-4"><ProgressBar value={done.length} max={7} label={`${done.length} of 7 stages`} /></div>
      <div className="mb-4 overflow-x-auto"><Tabs tabs={STAGES.map((s) => ({ id: s.id, label: <>{s.label}{stageDone(s.id) && <Icon name="check" size={14} className="ml-1 inline" />}</> }))} value={stage} onChange={setStage} /></div>
      <Card>
        {stage === "understand" && (<>
          {d.definition && <div className="mb-4"><h3 className="mb-1 font-semibold">Definition</h3><p className="text-sm">{d.definition}</p></div>}
          {d.purpose && <div className="mb-4"><h3 className="mb-1 font-semibold">Purpose</h3><p className="text-sm">{d.purpose}</p></div>}
          {d.anatomy && <div className="mb-4"><h3 className="mb-1 font-semibold">Relevant anatomy</h3><p className="text-sm">{d.anatomy}</p></div>}
          <List title="Learning objectives" items={d.objectives} /><List title="Indications" items={d.indications} />
          <List title="Contraindications and cautions" items={d.contraindications} /><List title="Expected outcomes" items={d.expected_outcomes} />
          <List title="Safety and infection control" items={d.safety} />
          <div className="ink-2 border-t pt-3 text-xs line">
            {d.references?.length > 0 && <p>Sources: {d.references.join("; ")}</p>}
            <p>{d.reviewer ? `Reviewed by ${d.reviewer}${d.reviewed_at ? `, ${d.reviewed_at}` : ""}` : "Not yet reviewed by a tutor"} · version {d.version}</p></div>
          <div className="mt-3"><MarkBtn s="understand" /></div></>)}

        {stage === "equipment" && (<>
          {d.equipment.length === 0 ? <p className="ink-2 text-sm">No equipment list yet.</p> : (
            <div className="grid gap-3 sm:grid-cols-2">{d.equipment.map((e: J) => (
              <div key={e.id} className="surface-2 rounded-xl p-3"><div className="font-medium">{e.name}</div>
                {e.purpose && <p className="text-sm"><b>Purpose:</b> {e.purpose}</p>}{e.correct_use && <p className="text-sm"><b>Use:</b> {e.correct_use}</p>}
                {e.precautions && <p className="text-sm text-amber-700 dark:text-amber-300"><b>Care:</b> {e.precautions}</p>}</div>))}</div>)}
          <div className="mt-4"><MarkBtn s="equipment" /></div>
          {d.candidates.length > 0 && <div className="mt-5"><EquipmentExercise p={d} onDone={() => undefined} /></div>}</>)}

        {stage === "prepare" && (<>
          {Object.keys(pp).length === 0 ? <p className="ink-2 text-sm">Follow your school's guidance on patient preparation, consent, privacy and positioning.</p> : Object.entries(pp).map(([k, v]) => (
            <div key={k} className="mb-3"><h3 className="mb-1 font-semibold capitalize">{k.replace(/_/g, " ")}</h3>{Array.isArray(v) ? <ul className="list-disc pl-5 text-sm">{(v as string[]).map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="text-sm">{String(v)}</p>}</div>))}
          <List title="Safety checks before you start" items={d.safety} /><MarkBtn s="prepare" /></>)}

        {stage === "video" && (<>
          {d.videos.length === 0 ? <EmptyState icon="video" title="No video yet">Demonstration videos are added by qualified instructors. Use the steps stage in the meantime.</EmptyState> : (<>
            <div className="mb-3 flex flex-wrap gap-2">{d.videos.map((v: J) => <Button key={v.id} size="sm" variant={vid === v.id ? "primary" : "secondary"} onClick={() => setVid(v.id)}>{v.title}{v.completed ? " ✓" : ""}</Button>)}</div>
            {vid ? <VideoPlayer videoId={vid} onWatched={() => mark("video")} /> : <p className="ink-2 text-sm">Choose a video above.</p>}</>)}
          <div className="mt-4"><MarkBtn s="video" /></div></>)}

        {stage === "steps" && (<>
          <ol className="space-y-4">{d.steps.map((s: J, i: number) => (
            <li key={s.id} className="rounded-xl border p-3 line">
              <div className="flex items-start gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-700 text-sm font-semibold text-white">{i + 1}</span>
                <div className="min-w-0 flex-1"><div className="font-medium">{s.action}{s.is_critical && <Badge tone="danger" className="ml-2">Critical</Badge>}</div>
                  {s.explanation && <p className="mt-1 text-sm">{s.explanation}</p>}
                  {s.rationale && <p className="mt-1 text-sm"><b>Why:</b> {s.rationale}</p>}
                  {s.safety && <p className="mt-1 text-sm text-amber-700 dark:text-amber-300"><b>Safety:</b> {s.safety}</p>}
                  {s.common_mistake && <p className="mt-1 text-sm text-red-700 dark:text-red-300"><b>Common mistake:</b> {s.common_mistake}</p>}
                  {s.expected_outcome && <p className="mt-1 text-sm"><b>Expected:</b> {s.expected_outcome}</p>}
                  {s.rationale && <RationaleExercise step={s} />}
                  <div className="mt-2">{know.includes(s.id) ? <Badge tone="success">Understood</Badge> : <Button size="sm" variant="secondary" onClick={() => mark("steps", s.id)}>I understand this step</Button>}</div></div></div></li>))}</ol>
          {d.steps.length > 1 && <div className="mt-5"><SequenceExercise p={d} onDone={() => mark("steps")} /></div>}</>)}

        {stage === "station" && (<>
          <p className="mb-3 text-sm">Test yourself with mistake-spotting and clinical-decision exercises, then try it in a timed station.</p>
          {d.exercises.length === 0 ? <p className="ink-2 text-sm">No exercises for this procedure yet.</p> : <div className="space-y-4">{d.exercises.map((x: J) => <PickExercise key={x.id} id={x.id} onDone={() => mark("station")} />)}</div>}
          <div className="mt-4 flex flex-wrap gap-2"><Link to="/caosce/exams"><Button variant="accent" icon="clock">Go to timed stations</Button></Link>
            {d.question_count > 0 && <Link to={`/caosce/questions?procedure=${d.id}`}><Button variant="secondary">Practise questions ({d.question_count})</Button></Link>}</div></>)}

        {stage === "results" && (<>
          <h3 className="mb-2 font-semibold">Your progress on this procedure</h3>
          <ul className="space-y-1 text-sm">{STAGES.slice(0, 6).map((s) => <li key={s.id} className="flex items-center gap-2"><Icon name={stageDone(s.id) ? "checkCircle" : "clock"} size={16} className={stageDone(s.id) ? "text-green-600" : "ink-2"} />{s.label.slice(2)}</li>)}</ul>
          <p className="ink-2 mt-3 text-sm">{know.length} of {d.steps.length} steps marked understood.</p>
          <div className="mt-4 flex gap-2"><MarkBtn s="results" /><Link to="/caosce/dashboard"><Button variant="secondary" size="sm">Open my dashboard</Button></Link><Button size="sm" variant="ghost" onClick={() => nav("/caosce/library")}>Back to library</Button></div></>)}
      </Card>
      <Disclaimer />
    </div>
  );
}

// ---------------------------------------------------------------- Lab (exercise hub)
export function CaosceLabPage() {
  const lib = useAsync(() => caosce.library(), []);
  const [pid, setPid] = useState("");
  const proc = useAsync(() => (pid ? caosce.procedure(pid) : Promise.resolve(null)), [pid]);
  const [kind, setKind] = useState("sequence");
  const d: J = proc.data;
  return (
    <div>
      <Back to="/caosce" label="CAOSCE Lab" />
      <PageHeader title="Virtual skills lab" subtitle="Practise the thinking behind each procedure without any equipment." />
      <Select value={pid} onChange={(e) => setPid(e.target.value)} aria-label="Procedure" className="mb-4"><option value="">Choose a procedure</option>{(lib.data ?? []).map((p: J) => <option key={p.id} value={p.id}>{p.name}{p.locked ? " (locked)" : ""}</option>)}</Select>
      {pid && proc.loading && <Loading />}
      {pid && proc.error && <ErrorBox message={proc.error} onRetry={proc.reload} />}
      {d && (<>
        <Tabs tabs={[{ id: "sequence", label: "Sequencing" }, { id: "equipment", label: "Equipment" }, { id: "mistake", label: "Spot mistakes" }, { id: "decision", label: "Decisions" }]} value={kind} onChange={setKind} />
        <div className="mt-4 space-y-4">
          {kind === "sequence" && (d.steps.length > 1 ? <SequenceExercise key={pid} p={d} onDone={() => undefined} /> : <p className="ink-2 text-sm">Not enough steps yet.</p>)}
          {kind === "equipment" && (d.candidates.length ? <EquipmentExercise key={pid} p={d} onDone={() => undefined} /> : <p className="ink-2 text-sm">No equipment list yet.</p>)}
          {(kind === "mistake" || kind === "decision") && (d.exercises.filter((x: J) => x.kind === kind).length ? d.exercises.filter((x: J) => x.kind === kind).map((x: J) => <PickExercise key={x.id} id={x.id} />) : <p className="ink-2 text-sm">No exercises of this type yet.</p>)}
        </div></>)}
      <Disclaimer />
    </div>
  );
}

// ---------------------------------------------------------------- Question practice
function QuestionInput({ q, value, onChange, locked }: { q: J; value: J; onChange: (v: J) => void; locked?: boolean }) {
  if (q.kind === "short" || q.kind === "scenario") return <Textarea rows={4} disabled={locked} value={value?.text ?? ""} onChange={(e) => onChange({ text: e.target.value })} placeholder="Answer in your own words" />;
  const multi = q.kind === "multi"; const sel: string[] = value?.selected ?? [];
  return <div className="space-y-2">{q.options.map((o: J) => (
    <label key={o.id} className="flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm line"><input type={multi ? "checkbox" : "radio"} disabled={locked} checked={sel.includes(o.id)}
      onChange={() => onChange({ selected: multi ? (sel.includes(o.id) ? sel.filter((x) => x !== o.id) : [...sel, o.id]) : [o.id] })} />{o.text}</label>))}</div>;
}

export function CaosceQuestionsPage() {
  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const procedure = params.get("procedure");
  const toast = useToast();
  const qs = useAsync(() => caosce.questions(procedure, 10), [procedure]);
  const [i, setI] = useState(0);
  const [ans, setAns] = useState<Record<string, J>>({});
  const [res, setRes] = useState<Record<string, J>>({});
  if (qs.loading) return <Loading />;
  if (qs.error) return <ErrorBox message={qs.error} onRetry={qs.reload} />;
  const list: J[] = qs.data ?? [];
  if (!list.length) return <div><Back to="/caosce" label="CAOSCE Lab" /><EmptyState icon="quiz" title="No questions available yet">Published question stations will appear here.</EmptyState></div>;
  const q = list[i]; const r = res[q.id];
  const check = async () => { try { setRes({ ...res, [q.id]: await caosce.questionCheck(q.id, ans[q.id] ?? {}) }); } catch (e) { toast(friendly(e), "error"); } };
  const vals = Object.values(res) as J[];
  const total = vals.reduce((s: number, x: J) => s + x.score, 0), max = vals.reduce((s: number, x: J) => s + x.max, 0);
  return (
    <div className="mx-auto max-w-2xl">
      <Back to="/caosce" label="CAOSCE Lab" />
      <PageHeader title="Question station practice" subtitle={`Question ${i + 1} of ${list.length}${max ? ` · score ${total}/${max}` : ""}`} />
      <ProgressBar value={i + (r ? 1 : 0)} max={list.length} />
      <Card className="mt-4">
        {q.procedure && <Badge>{q.procedure}</Badge>}
        <h2 className="mb-3 mt-2 font-semibold">{q.stem}</h2>
        <QuestionInput q={q} value={ans[q.id]} onChange={(v) => setAns({ ...ans, [q.id]: v })} locked={!!r} />
        {!r ? <Button className="mt-3" onClick={check}>Check answer</Button> : (
          <div className="mt-3 space-y-2 text-sm"><Badge tone={tone(100 * r.score / r.max)}>{r.score} / {r.max}</Badge>
            {r.options?.filter((o: J) => o.correct).map((o: J) => <p key={o.id}><b>Correct:</b> {o.text}</p>)}
            {r.model_answer && <p className="surface-2 rounded-lg p-3"><b>Model answer:</b> {r.model_answer}</p>}
            {(r.explanation || r.rationale) && <p>{r.explanation ?? r.rationale}</p>}
            <div className="flex justify-end">{i < list.length - 1 ? <Button onClick={() => setI(i + 1)}>Next</Button> : <Link to="/caosce"><Button>Finish</Button></Link>}</div></div>)}
      </Card>
      <Disclaimer />
    </div>
  );
}

// ---------------------------------------------------------------- Exams
export function CaosceExamsPage() {
  const nav = useNavigate();
  const toast = useToast();
  const ex = useAsync(() => caosce.exams(), []);
  const [busy, setBusy] = useState("");
  const start = async (exam: string, mode: "mock" | "timed_station" | "revision" = "mock", pos?: number) => {
    setBusy(exam + mode + (pos ?? ""));
    try { nav(`/caosce/exam/${await caosce.examStart(exam, mode, pos)}`); }
    catch (e) { const m = friendly(e); if (m.includes("unlocked")) nav("/plans"); else toast(m, "error"); } finally { setBusy(""); }
  };
  if (ex.loading) return <Loading />;
  if (ex.error || !ex.data) return <ErrorBox message={ex.error ?? ""} onRetry={ex.reload} />;
  const d: J = ex.data;
  return (
    <div>
      <Back to="/caosce" label="CAOSCE Lab" />
      <PageHeader title="Mock CAOSCE" subtitle="Timed stations. The server keeps the clock, so refreshing the page does not give you extra time." />
      {d.exams.length === 0 ? <EmptyState icon="clipboard" title="No mock exams published yet">Tutors are still reviewing the first set.</EmptyState> : (
        <div className="space-y-4">{d.exams.map((e: J) => (
          <Card key={e.id}>
            <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="font-semibold">{e.title}</h2><p className="ink-2 text-sm">{e.description}</p></div>
              {e.best_percent != null && <Badge tone={tone(e.best_percent)}>Best {e.best_percent}%</Badge>}</div>
            <ol className="mt-3 space-y-1 text-sm">{e.stations.map((s: J) => (
              <li key={s.position} className="flex items-center justify-between gap-2"><span>{s.position}. {s.title} <span className="ink-2">({Math.round(s.seconds / 60)} min)</span></span>
                <Button size="sm" variant="ghost" loading={busy === e.id + "timed_station" + s.position} onClick={() => start(e.id, "timed_station", s.position)}>Practise only this</Button></li>))}</ol>
            <div className="mt-4 flex flex-wrap gap-2">
              {e.open_attempt && <Link to={`/caosce/exam/${e.open_attempt}`}><Button variant="accent">Continue attempt</Button></Link>}
              <Button loading={busy === e.id + "mock"} onClick={() => start(e.id)} icon="play">Start full mock</Button>
              <Button variant="secondary" loading={busy === e.id + "revision"} onClick={() => start(e.id, "revision")}>Revise my weak stations</Button></div>
          </Card>))}</div>)}
      <Disclaimer />
    </div>
  );
}

export function CaosceExamSessionPage() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const toast = useToast();
  const [g, setG] = useState<J>(null);
  const [err, setErr] = useState<string | null>(null);
  const [procText, setProcText] = useState("");
  const [viva, setViva] = useState<Record<string, string>>({});
  const [qa, setQa] = useState<Record<string, J>>({});
  const [leftSnap, setLeftSnap] = useState<{ at: number; secs: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const posRef = useRef(0);
  const dirty = useRef(false);

  const load = useCallback((data: J) => {
    if (data.status !== "in_progress") { nav(`/caosce/report/${id}`); return; }
    const c = data.current;
    if (c.position !== posRef.current) {
      posRef.current = c.position;
      setProcText(c.answers?.procedure ?? ""); setViva(c.answers?.viva ?? {}); setQa(c.answers?.answers ?? {});
    }
    setLeftSnap({ at: Date.now(), secs: c.seconds_left }); setG(data);
  }, [id, nav]);
  useEffect(() => { caosce.examGet(id).then(load, (e) => setErr(friendly(e))); }, [id, load]);
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 500); return () => window.clearInterval(t); }, []);

  const left = leftSnap ? Math.max(0, leftSnap.secs - Math.floor((now - leftSnap.at) / 1000)) : null;
  const payload = useCallback(() => (g?.current?.kind === "procedure" ? { procedure: procText, viva } : { answers: qa }), [g, procText, viva, qa]);
  const save = useCallback(async () => {
    if (!g || !dirty.current) return; dirty.current = false;
    try { await caosce.examSave(id, g.current.position, payload()); } catch { /* time may be up; refresh below */ }
  }, [g, id, payload]);
  useEffect(() => { if (!dirty.current) return; const t = window.setTimeout(save, 1500); return () => window.clearTimeout(t); }, [procText, viva, qa, save]);
  const timedOut = useRef(false);
  useEffect(() => {
    if (left === 0 && g && !timedOut.current) {
      timedOut.current = true;
      void (async () => { await save(); try { load(await caosce.examGet(id)); } catch (e) { setErr(friendly(e)); } timedOut.current = false; })();
    }
  }, [left, g, id, load, save]);

  const next = async () => {
    try { dirty.current = true; await caosce.examSave(id, g.current.position, payload()); dirty.current = false; load(await caosce.examNext(id)); }
    catch (e) { toast(friendly(e), "error"); try { load(await caosce.examGet(id)); } catch { /* ignore */ } }
  };
  if (err) return <ErrorBox message={err} />;
  if (!g) return <Loading />;
  const c: J = g.current; const last = g.position >= g.total_stations;
  return (
    <div className="mx-auto max-w-3xl pb-24">
      <div className="surface sticky top-0 z-10 -mx-4 mb-4 flex items-center justify-between border-b px-4 py-2 line sm:mx-0 sm:rounded-b-xl">
        <div><div className="text-sm font-semibold">{g.exam.title}</div><div className="ink-2 text-xs">Station {g.position} of {g.total_stations}</div></div>
        <Badge tone={left != null && left < 60 ? "danger" : "brand"}><Icon name="clock" size={14} className="mr-1 inline" />{left != null ? mmss(left) : "--"}</Badge>
      </div>
      {g.position === 1 && <p className="ink-2 mb-3 text-sm">{g.exam.instructions}</p>}
      <Card>
        <Badge tone="brand">{c.kind === "procedure" ? "Procedure station" : "Question station"}</Badge>
        <h2 className="mb-2 mt-2 text-lg font-semibold">{c.title}</h2>
        {c.kind === "procedure" ? (<>
          {c.scenario && <div className="surface-2 mb-3 rounded-lg p-3 text-sm"><b>Scenario:</b> {c.scenario}</div>}
          {c.candidate_instructions && <div className="mb-3 text-sm"><b>Instructions:</b> {c.candidate_instructions}</div>}
          <label className="text-sm font-medium" htmlFor="proc">Describe, in order, everything you would do. Include preparation, safety, each step, and aftercare.</label>
          <Textarea id="proc" rows={12} value={procText} onChange={(e) => { dirty.current = true; setProcText(e.target.value); }} placeholder="Write the steps in your own words. Use the words you normally use; you are marked on meaning." />
          {c.viva.length > 0 && <div className="mt-4 space-y-3"><h3 className="font-semibold">Examiner's questions</h3>{c.viva.map((v: J) => (
            <div key={v.id}><label className="text-sm" htmlFor={v.id}>{v.prompt} <span className="ink-2">({v.marks} marks)</span></label>
              <Textarea id={v.id} rows={3} value={viva[v.id] ?? ""} onChange={(e) => { dirty.current = true; setViva({ ...viva, [v.id]: e.target.value }); }} /></div>))}</div>}
        </>) : (
          <div className="space-y-5">{c.questions.map((q: J, n: number) => (
            <div key={q.id}><div className="mb-2 text-sm font-medium">{n + 1}. {q.stem}</div>
              <QuestionInput q={q} value={qa[q.id]} onChange={(v) => { dirty.current = true; setQa({ ...qa, [q.id]: v }); }} /></div>))}</div>)}
      </Card>
      <div className="fixed inset-x-0 bottom-0 z-10 border-t bg-[var(--surface)] p-3 line"><div className="mx-auto flex max-w-3xl items-center justify-between gap-2">
        <span className="ink-2 text-xs">Answers save automatically.</span>
        <Button onClick={next}>{last ? "Finish exam" : "Finish station and continue"}</Button></div></div>
    </div>
  );
}

export function CaosceReportPage() {
  const { id } = useParams<{ id: string }>();
  const r = useAsync(() => caosce.examReport(id), [id]);
  if (r.loading) return <Loading />;
  if (r.error || !r.data) return <ErrorBox message={r.error ?? ""} onRetry={r.reload} />;
  const d: J = r.data;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow={d.exam} title={`${d.percent ?? 0}%`} subtitle={`${d.score} of ${d.max} marks · pass mark in this practice ${d.pass_percent}%`}
        actions={<Badge tone={d.passed ? "success" : "danger"}>{d.passed ? "Practice pass" : "Below practice pass mark"}</Badge>} />
      <div className="space-y-4">{d.stations.map((s: J) => (
        <Card key={s.position}>
          <div className="flex justify-between gap-2"><h3 className="font-semibold">{s.position}. {s.title}</h3><Badge tone={tone(s.max ? 100 * s.score / s.max : 0)}>{s.score}/{s.max}</Badge></div>
          {s.detail?.timed_out && <p className="mt-1 text-sm text-red-600">Time ran out at this station.</p>}
          {s.detail?.note && <p className="ink-2 mt-1 text-xs">{s.detail.note}</p>}
          {s.detail?.critical_missed?.length > 0 && <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"><b>Critical steps you did not mention:</b><ul className="list-disc pl-5">{s.detail.critical_missed.map((c: J) => <li key={c.id}>{c.step}</li>)}</ul></div>}
          {s.detail?.checklist && <div className="mt-3"><div className="mb-1 text-sm font-semibold">Marking checklist</div><ul className="space-y-1 text-sm">{s.detail.checklist.map((i: J) => (
            <li key={i.id} className="flex gap-2"><Icon name={i.status === "done" ? "check" : i.status === "partial" ? "info" : "x"} size={16} className={i.status === "done" ? "text-green-600" : i.status === "partial" ? "text-amber-600" : "text-red-600"} /><span className="flex-1">{i.step}</span><span className="ink-2">{i.awarded}/{i.points}</span></li>))}</ul></div>}
          {s.detail?.viva?.map((v: J) => <div key={v.id} className="mt-3 text-sm"><div className="font-medium">{v.prompt} <span className="ink-2">{v.awarded}/{v.marks}</span></div>{v.answer && <p className="ink-2">Your answer: {v.answer}</p>}{v.expected_points && <p><b>Marking guide:</b> {v.expected_points}</p>}</div>)}
          {s.detail?.questions?.map((q: J) => <div key={q.id} className="surface-2 mt-3 rounded-lg p-3 text-sm"><div className="font-medium">{q.stem} <span className="ink-2">{q.score}/{q.max}</span></div>
            {q.options?.filter((o: J) => o.correct).map((o: J) => <p key={o.id}><b>Correct:</b> {o.text}</p>)}{q.model_answer && <p><b>Model answer:</b> {q.model_answer}</p>}{(q.explanation || q.rationale) && <p>{q.explanation ?? q.rationale}</p>}</div>)}
          {s.revise && <Link to={`/caosce/procedure/${s.revise.id}`}><Button className="mt-3" size="sm" variant="secondary">Revise: {s.revise.name}</Button></Link>}
        </Card>))}</div>
      <div className="mt-5 flex gap-2"><Link to="/caosce/exams"><Button>More stations</Button></Link><Link to="/caosce/dashboard"><Button variant="secondary">Dashboard</Button></Link></div>
      <p className="ink-2 mt-6 text-xs">{d.disclaimer} The procedure stations are marked on what you wrote; they do not show that you can perform the skill. Practise with a skilled instructor.</p>
    </div>
  );
}

// ---------------------------------------------------------------- Dashboard
export function CaosceDashboardPage() {
  const d = useAsync(() => caosce.dashboard(), []);
  const data: J = useMemo(() => d.data, [d.data]);
  if (d.loading) return <Loading />;
  if (d.error || !data) return <ErrorBox message={d.error ?? ""} onRetry={d.reload} />;
  return (
    <div>
      <Back to="/caosce" label="CAOSCE Lab" />
      <PageHeader title="My CAOSCE progress" />
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Procedures started" value={`${data.procedures_started}/${data.procedures_total}`} /><Stat label="Completed" value={data.procedures_done} />
        <Stat label="Exercise average" value={data.exercise_avg != null ? `${data.exercise_avg}%` : "-"} /><Stat label="Videos watched" value={`${data.videos.completed}/${data.videos.started}`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><h2 className="mb-2 font-semibold">Weak procedures</h2>{data.weak_procedures.length === 0 ? <p className="ink-2 text-sm">Nothing below 70% yet.</p> : data.weak_procedures.map((w: J) => <Link key={w.id} to={`/caosce/procedure/${w.id}`} className="flex justify-between py-1 text-sm hover:underline"><span>{w.name}</span><span className="ink-2">{w.percent}%</span></Link>)}</Card>
        <Card><h2 className="mb-2 font-semibold">Critical steps you often miss</h2>{data.critical_mistakes.length === 0 ? <p className="ink-2 text-sm">None recorded.</p> : <ul className="list-disc space-y-1 pl-5 text-sm">{data.critical_mistakes.map((c: string, i: number) => <li key={i}>{c}</li>)}</ul>}</Card>
        <Card><h2 className="mb-2 font-semibold">By exercise type</h2>{data.by_kind.length === 0 ? <p className="ink-2 text-sm">No exercises yet.</p> : data.by_kind.map((k: J) => <div key={k.kind} className="mb-2"><div className="flex justify-between text-sm"><span className="capitalize">{k.kind}</span><span className="ink-2">{k.percent}% · {k.attempts}</span></div><ProgressBar value={k.percent ?? 0} /></div>)}</Card>
        <Card><h2 className="mb-2 font-semibold">Mock exams</h2>{data.exams.length === 0 ? <p className="ink-2 text-sm">No mock exams yet.</p> : data.exams.map((e: J) => <Link key={e.id} to={`/caosce/report/${e.id}`} className="flex justify-between py-1 text-sm hover:underline"><span>{e.exam}</span><Badge tone={tone(e.percent)}>{e.percent}%</Badge></Link>)}</Card>
      </div>
      <Disclaimer />
    </div>
  );
}
