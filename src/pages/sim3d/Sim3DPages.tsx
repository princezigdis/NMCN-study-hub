import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "../../lib/router";
import { useAsync } from "../../lib/useAsync";
import { friendly } from "../../lib/errors";
import { sim3d } from "../../lib/sim3d";
import { tone as pctTone, type J } from "../../lib/lab";
import { mmss } from "../../lib/speech";
import { Badge, Button, Card, EmptyState, ErrorBox, Loading, Modal, PageHeader, ProgressBar, Stat, Tabs, useConfirm, useToast } from "../../components/ui";
import { Icon } from "../../components/Icon";
import { ClinicalScene } from "../../sim3d/scene";
import { ItemViewer } from "../../sim3d/viewer";
import { autoQuality, tone as beep, webglAvailable } from "../../sim3d/sound";
import type { CameraPreset, PickInfo, Quality, SceneData } from "../../sim3d/types";

const MODES: Array<{ id: "guided" | "practice" | "exam"; label: string; text: string }> = [
  { id: "guided", label: "Guided", text: "Step-by-step help. You see the next step, hints and the reason for each action." },
  { id: "practice", label: "Free practice", text: "No prompts. Ask for a hint when stuck. Immediate feedback on safety errors." },
  { id: "exam", label: "Timed exam", text: "Timer runs, no feedback until the end. Your marked checklist appears at the finish." },
];

function Back({ to, label = "Back" }: { to: string; label?: string }) {
  return <Link to={to} className="ink-2 mb-3 inline-flex items-center gap-1 text-sm hover:underline"><Icon name="chevronLeft" size={16} />{label}</Link>;
}

function List({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return <div><h3 className="mb-1 text-sm font-semibold">{title}</h3><ul className="ink-2 list-disc space-y-0.5 pl-5 text-sm">{items.map((x) => <li key={x}>{x}</li>)}</ul></div>;
}

function Locked() {
  return (
    <Card className="mx-auto max-w-2xl text-center">
      <Icon name="lock" size={28} className="mx-auto mb-2 text-brand-600" />
      <h2 className="text-lg font-semibold">3D CAOSCE Lab is part of Sections C and D</h2>
      <p className="ink-2 mx-auto mt-2 max-w-lg text-sm">Practise clinical procedures in a live 3D ward: move around the bed, pick your equipment, position the patient, perform each step and get a marked checklist at the end. Unlock Section C (Mock Examination) or Section D (Final Examination) to open it.</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Link to="/mock"><Button>Unlock with Section C</Button></Link>
        <Link to="/final"><Button variant="secondary">Unlock with Section D</Button></Link>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- equipment viewer modal
function EquipmentModal({ item, onClose }: { item: J | null; onClose: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const gl = useMemo(() => webglAvailable(), []);
  useEffect(() => {
    if (!item || !gl || !ref.current) return;
    let v: ItemViewer | null = null;
    try { v = new ItemViewer(ref.current, item.key); } catch { v = null; }
    return () => v?.dispose();
  }, [item, gl]);
  return (
    <Modal open={!!item} onClose={onClose} title={item?.name ?? ""} wide>
      {item && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="surface-2 relative h-64 overflow-hidden rounded-xl border line">
            {gl ? <canvas ref={ref} className="h-full w-full" aria-label={`3D model of ${item.name}. Drag to rotate.`} /> : <div className="ink-2 flex h-full items-center justify-center p-4 text-center text-sm">3D view is not available on this device.</div>}
          </div>
          <EquipInfo e={item} />
        </div>
      )}
    </Modal>
  );
}

function EquipInfo({ e }: { e: J }) {
  const rows: Array<[string, string | undefined]> = [["What it is", e.description], ["Purpose", e.purpose], ["How to use it", e.how_to_use], ["Precautions", e.precautions], ["Infection prevention", e.infection_notes], ["Common mistakes", e.mistakes]];
  return (
    <div className="space-y-2 text-sm">
      {e.category && <Badge tone="brand">{e.category}</Badge>}
      {rows.filter(([, v]) => v).map(([k, v]) => <div key={k}><div className="text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">{k}</div><div className="ink-2">{v}</div></div>)}
    </div>
  );
}

// ---------------------------------------------------------------- home
export function Sim3DHomePage() {
  const list = useAsync(() => sim3d.list(), []);
  const [tab, setTab] = useState<"procedures" | "equipment" | "results">("procedures");
  const hist = useAsync(() => sim3d.history().catch(() => null), []);
  const equip = useAsync(() => sim3d.equipment().catch(() => [] as J[]), []);
  const [view, setView] = useState<J | null>(null);
  if (list.loading) return <Loading />;
  if (list.error || !list.data) return <ErrorBox message={list.error ?? "Could not load."} onRetry={list.reload} />;
  const d: J = list.data;
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader eyebrow="Sections C and D" title="3D CAOSCE Lab" subtitle="A live 3D ward. Prepare, position, perform and be marked step by step." />
      {!d.access ? <Locked /> : (
        <>
          <Tabs tabs={[{ id: "procedures", label: "Procedures" }, { id: "equipment", label: "Equipment library" }, { id: "results", label: "My results" }]} value={tab} onChange={setTab} />
          {tab === "procedures" && (
            d.items.length === 0 ? <EmptyState icon="cube" title="No procedures yet">Procedures are being prepared.</EmptyState> :
            <div className="grid gap-4 sm:grid-cols-2">
              {d.items.map((p: J) => (
                <Card key={p.id}>
                  <div className="mb-1 flex flex-wrap items-center gap-2"><Badge tone="brand">{p.category}</Badge><Badge>{p.difficulty}</Badge>{p.programme !== "ALL" && <Badge tone="info">{p.programme}</Badge>}</div>
                  <h2 className="font-semibold">{p.title}</h2>
                  <p className="ink-2 mt-1 text-sm">{p.description}</p>
                  <div className="ink-2 mt-2 text-xs">{p.steps} steps · about {p.minutes} min{p.best != null && <> · best {Math.round(p.best)}%</>}</div>
                  <div className="mt-3"><Link to={`/sim3d/procedure/${p.id}`}><Button size="sm">Open</Button></Link></div>
                </Card>
              ))}
            </div>
          )}
          {tab === "equipment" && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {(equip.data ?? []).map((e: J) => (
                <button key={e.key} onClick={() => setView(e)} className="surface rounded-xl border line p-3 text-left transition-colors hover:border-brand-500">
                  <Icon name="cube" className="mb-1 text-brand-600" />
                  <div className="text-sm font-semibold">{e.name}</div>
                  <div className="ink-2 text-xs">{e.category}</div>
                </button>
              ))}
            </div>
          )}
          {tab === "results" && (
            <div>
              <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Attempts" value={hist.data?.summary?.count ?? 0} />
                <Stat label="Average" value={hist.data?.summary?.avg != null ? `${hist.data.summary.avg}%` : "-"} />
                <Stat label="Best" value={hist.data?.summary?.best != null ? `${hist.data.summary.best}%` : "-"} />
                <Stat label="Passed" value={hist.data?.summary?.passed ?? 0} />
              </div>
              {hist.data?.open && <Link to={`/sim3d/play/${hist.data.open}`}><Button variant="accent" className="mb-3">Resume your open session</Button></Link>}
              {!(hist.data?.attempts ?? []).length ? <EmptyState icon="clipboard" title="No results yet">Finish a procedure to see your marked checklist here.</EmptyState> : (
                <Card className="divide-y line">
                  {hist.data.attempts.map((a: J) => (
                    <Link key={a.id} to={`/sim3d/play/${a.id}`} className="flex items-center justify-between gap-2 py-2 text-sm hover:underline">
                      <span className="min-w-0 truncate">{a.title} <span className="ink-2">· {a.mode}</span></span>
                      <Badge tone={pctTone(a.percent)}>{a.percent != null ? `${Math.round(a.percent)}%` : a.status}</Badge>
                    </Link>
                  ))}
                </Card>
              )}
            </div>
          )}
        </>
      )}
      <EquipmentModal item={view} onClose={() => setView(null)} />
    </div>
  );
}

// ---------------------------------------------------------------- procedure detail + challenges
function Challenge({ pid, c }: { pid: string; c: J }) {
  const toast = useToast();
  const [sel, setSel] = useState<string[]>([]);
  const [res, setRes] = useState<J | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) => setSel((s) => c.multi ? (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]) : [id]);
  const check = async () => {
    setBusy(true);
    try { setRes(await sim3d.challengeCheck(pid, c.id, sel)); } catch (e) { toast(friendly(e), "error"); } finally { setBusy(false); }
  };
  return (
    <Card>
      <div className="mb-1 flex items-center gap-2"><Badge tone={c.kind === "mistake" ? "warning" : "info"}>{c.kind === "mistake" ? "Spot the mistakes" : "Clinical decision"}</Badge><h3 className="font-semibold">{c.title}</h3></div>
      <p className="ink-2 text-sm">{c.scenario}</p>
      <p className="mt-2 text-sm font-medium">{c.prompt}{c.multi ? " (select all that apply)" : ""}</p>
      <div className="mt-2 space-y-2">
        {c.options.map((o: J) => {
          const r = res?.options?.find((x: J) => x.id === o.id);
          return (
            <label key={o.id} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm line ${r ? (r.correct ? "border-emerald-500" : r.selected ? "border-red-500" : "") : sel.includes(o.id) ? "border-brand-500" : ""}`}>
              <input type={c.multi ? "checkbox" : "radio"} name={c.id} checked={sel.includes(o.id)} disabled={!!res} onChange={() => toggle(o.id)} className="mt-1" />
              <span className="flex-1">{o.text}{r && <span className="ink-2 mt-0.5 block text-xs">{r.feedback}</span>}</span>
            </label>
          );
        })}
      </div>
      {res ? (
        <div className="mt-3 text-sm"><Badge tone={res.correct ? "success" : "danger"}>{res.correct ? "Correct" : "Not quite"}</Badge> <span className="ink-2">{res.explanation}</span>
          <div className="mt-2"><Button size="sm" variant="secondary" onClick={() => { setRes(null); setSel([]); }}>Try again</Button></div></div>
      ) : <div className="mt-3"><Button size="sm" onClick={check} loading={busy} disabled={!sel.length}>Check</Button></div>}
    </Card>
  );
}

export function Sim3DProcedurePage() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const toast = useToast();
  const p = useAsync(() => sim3d.get(id), [id]);
  const ch = useAsync(() => sim3d.challenges(id).catch(() => [] as J[]), [id]);
  const [busy, setBusy] = useState("");
  if (p.loading) return <Loading />;
  if (p.error || !p.data) return (
    <div className="mx-auto max-w-3xl"><Back to="/sim3d" label="3D CAOSCE Lab" /><ErrorBox message={p.error ?? "Could not load."} onRetry={p.reload} /></div>
  );
  const d: J = p.data;
  const start = async (mode: "guided" | "practice" | "exam") => {
    setBusy(mode);
    try { nav(`/sim3d/play/${await sim3d.start(id, mode)}`); } catch (e) { toast(friendly(e), "error"); setBusy(""); }
  };
  return (
    <div className="mx-auto max-w-4xl">
      <Back to="/sim3d" label="3D CAOSCE Lab" />
      <PageHeader eyebrow={d.category} title={d.title} subtitle={d.description} />
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {MODES.map((m) => (
          <Card key={m.id}>
            <h2 className="font-semibold">{m.label}{m.id === "exam" && <span className="ink-2 text-sm font-normal"> · {Math.round(d.exam_seconds / 60)} min</span>}</h2>
            <p className="ink-2 mt-1 min-h-[3.5rem] text-sm">{m.text}</p>
            <Button className="mt-2 w-full" variant={m.id === "exam" ? "primary" : "secondary"} loading={busy === m.id} onClick={() => start(m.id)}>Start {m.label.toLowerCase()}</Button>
          </Card>
        ))}
      </div>
      <Card className="mb-5 space-y-4">
        {d.definition && <div><h3 className="mb-1 text-sm font-semibold">Definition</h3><p className="ink-2 text-sm">{d.definition}</p></div>}
        <div className="grid gap-4 sm:grid-cols-2">
          <List title="Objectives" items={d.objectives} /><List title="Indications" items={d.indications} />
          <List title="Contraindications and cautions" items={d.contraindications} /><List title="Safety points" items={d.safety} />
          <List title="Expected outcomes" items={d.outcomes} /><List title="References" items={d.refs} />
        </div>
        <div><h3 className="mb-1 text-sm font-semibold">Equipment you can inspect in 3D</h3>
          <div className="flex flex-wrap gap-1.5">{d.scene.equipment.map((e: J) => <Badge key={e.key}>{e.name}</Badge>)}</div></div>
      </Card>
      {(ch.data ?? []).length > 0 && (
        <div className="space-y-3"><h2 className="text-lg font-semibold">Mistake spotting and clinical decisions</h2>
          {(ch.data ?? []).map((c: J) => <Challenge key={c.id} pid={id} c={c} />)}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- results view
function ResultView({ r, title, onAgain, procedureId }: { r: J; title: string; onAgain: () => void; procedureId: string }) {
  const badge = (s: string) => <Badge tone={s === "done" ? "success" : s === "partial" ? "warning" : "danger"}>{s === "done" ? "Done" : s === "partial" ? "Partly / out of sequence" : s === "wrong" ? "Incorrect" : "Missed"}</Badge>;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="Marked checklist" title={title} />
      <Card className="mb-4 text-center">
        <div className="text-5xl font-bold">{Math.round(r.percent)}%</div>
        <div className="mt-1"><Badge tone={r.passed ? "success" : "danger"}>{r.passed ? "Pass" : "Below pass mark"}</Badge> <span className="ink-2 text-sm">Pass mark {r.pass_percent}% · {r.score} of {r.max} marks · {mmss(r.seconds ?? 0)}</span></div>
        {r.timed_out && <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">Time ran out. Steps not done were marked as missed.</p>}
      </Card>
      {(r.critical_errors ?? []).length > 0 && (
        <Card className="mb-4 border-red-300 dark:border-red-900">
          <h2 className="mb-2 font-semibold text-red-700 dark:text-red-300">Critical errors</h2>
          <ul className="space-y-1 text-sm">{r.critical_errors.map((c: J, i: number) => <li key={i} className="flex gap-2"><Icon name="alert" size={16} className="mt-0.5 shrink-0 text-red-600" />{c.message}</li>)}</ul>
        </Card>
      )}
      {(r.unsafe ?? []).length > 0 && (
        <Card className="mb-4"><h2 className="mb-2 font-semibold">Unsafe or incorrect actions</h2>
          <ul className="ink-2 list-disc space-y-1 pl-5 text-sm">{r.unsafe.map((u: J, i: number) => <li key={i}>{u.message}</li>)}</ul></Card>
      )}
      <Card className="mb-4">
        <h2 className="mb-3 font-semibold">Marking guide</h2>
        <div className="divide-y line">
          {r.steps.map((s: J) => (
            <div key={s.key} className="py-2.5 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium">{s.title}{s.critical && <Badge tone="danger" className="ml-2">Critical</Badge>}</div>
                <div className="flex items-center gap-2">{badge(s.status)}<span className="ink-2 text-xs">{s.got}/{s.marks}</span></div>
              </div>
              {s.rationale && <p className="ink-2 mt-0.5 text-xs">{s.rationale}</p>}
            </div>
          ))}
        </div>
      </Card>
      <div className="flex flex-wrap gap-2">
        <Button onClick={onAgain}>Try again</Button>
        <Link to={`/sim3d/procedure/${procedureId}`}><Button variant="secondary">Procedure page</Button></Link>
        <Link to="/sim3d"><Button variant="ghost">All procedures</Button></Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- player
type PanelTab = "task" | "tray" | "patient" | "actions" | "questions";
const PRESET_BUTTONS: Array<[CameraPreset, string]> = [["overview", "Room"], ["patient", "Patient"], ["head", "Head"], ["foot", "Foot"], ["top", "Above"], ["sink", "Sink"], ["trolley", "Trolley"]];
const OBJECT_ACTION: Record<string, string> = { sink: "hand_hygiene", curtain: "close_curtain", patient: "explain_consent" };
const OBJECT_TEXT: Record<string, string> = {
  bed: "Adjustable hospital bed with side rails and wheels. Lock the brakes and set a safe working height before a procedure.",
  sink: "Hand-washing sink with soap, running water and paper towels. Hand hygiene comes before and after every patient contact.",
  trolley: "Clean procedure trolley. Set out only what you need, clean items on the top shelf.",
  locker: "Patient's bedside locker. Keep the patient's own belongings here, not clinical equipment.",
  bins: "Yellow bin for clinical waste, black bin for general waste. Sharps go in the sharps box, never in a bag.",
  iv_stand: "IV stand for fluid bags. Not needed for this procedure unless ordered.",
  patient: "Training manikin with joints that can be positioned. Always introduce yourself and explain before you touch.",
};

export function Sim3DPlayPage() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const toast = useToast();
  const { confirm, confirmNode } = useConfirm();
  const sess = useAsync(() => sim3d.session(id), [id]);
  const [result, setResult] = useState<J | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => { if (sess.data?.attempt?.status === "finished" && sess.data.attempt.result) setResult(sess.data.attempt.result); }, [sess.data]);

  if (sess.loading) return <Loading label="Opening the ward…" />;
  if (sess.error || !sess.data) return <div className="mx-auto max-w-3xl"><Back to="/sim3d" /><ErrorBox message={sess.error ?? "Could not load."} onRetry={sess.reload} /></div>;
  const s: J = sess.data;
  const again = async () => {
    setStarting(true);
    try { const mode = s.attempt.mode as "guided" | "practice" | "exam"; nav(`/sim3d/play/${await sim3d.start(s.procedure.id, mode)}`); } catch (e) { toast(friendly(e), "error"); setStarting(false); }
  };
  if (result) return <div>{starting && <Loading />}<ResultView r={result} title={s.procedure.title} onAgain={again} procedureId={s.procedure.id} /></div>;
  if (s.attempt.status !== "in_progress") return (
    <div className="mx-auto max-w-xl"><Back to="/sim3d" /><EmptyState icon="clock" title="This session has ended" action={<Link to={`/sim3d/procedure/${s.procedure.id}`}><Button>Start again</Button></Link>}>It was replaced by a newer session or expired.</EmptyState></div>
  );
  return <Player key={id} s={s} id={id} onDone={setResult} confirm={confirm} node={confirmNode} />;
}

function Player({ s, id, onDone, confirm, node }: { s: J; id: string; onDone: (r: J) => void; confirm: (t: string, b: ReactNode, o?: { danger?: boolean; confirmLabel?: string }) => Promise<boolean>; node: ReactNode }) {
  const toast = useToast();
  const mode = s.attempt.mode as "guided" | "practice" | "exam";
  const exam = mode === "exam";
  const scene: SceneData = s.scene;
  const steps: J[] = s.steps;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const holderRef = useRef<HTMLDivElement>(null);
  const engine = useRef<ClinicalScene | null>(null);
  const gl = useMemo(() => webglAvailable(), []);
  const [loadPct, setLoadPct] = useState({ label: "Starting", pct: 0 });
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(!gl);
  const [quality, setQuality] = useState<Quality>(() => autoQuality());
  const [sound, setSound] = useState(false);
  const [tab, setTab] = useState<PanelTab>("task");
  const [pick, setPick] = useState<PickInfo | null>(null);
  const [hover, setHover] = useState<{ p: PickInfo; x: number; y: number } | null>(null);
  const [tray, setTray] = useState<string[]>([]);
  const [pose, setPose] = useState<string>(scene.pose);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "bad" | "info"; text: string; why?: string } | null>(null);
  const [next, setNext] = useState<J | null>(s.next ?? null);
  const [doneKeys, setDoneKeys] = useState<string[]>(s.attempt.done ?? []);
  const [answered, setAnswered] = useState<string[]>([]);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [zonesOn, setZonesOn] = useState(true);
  const lastZone = useRef<string | null>(null);

  // ---- timer (server time is the authority)
  const offset = useMemo(() => (s.attempt.server_now ? Date.parse(s.attempt.server_now) - Date.now() : 0), [s.attempt.server_now]);
  const deadline = s.attempt.deadline_at ? Date.parse(s.attempt.deadline_at) : null;
  const [left, setLeft] = useState<number | null>(deadline ? Math.max(0, Math.round((deadline - (Date.now() + offset)) / 1000)) : null);
  const finishRef = useRef<() => void>(() => undefined);

  // ---- 3D engine
  useEffect(() => {
    if (!gl || !canvasRef.current) return;
    let dead = false;
    let eng: ClinicalScene | null = null;
    ClinicalScene.create(canvasRef.current, {
      quality,
      onProgress: (label, pct) => { if (!dead) setLoadPct({ label, pct }); },
      onPick: (p) => { setPick(p); eng?.highlight(p ? { kind: p.kind, key: p.key } : null); if (p) setTab((t) => (p.kind === "equipment" ? "tray" : t)); },
      onHover: (p, x, y) => setHover(p ? { p, x, y } : null),
      onContextLost: () => setFailed(true),
    }).then((e) => {
      if (dead) { e.dispose(); return; }
      eng = e;
      engine.current = e;
      e.load(scene);
      setReady(true);
    }).catch(() => { if (!dead) setFailed(true); });
    return () => { dead = true; engine.current = null; eng?.dispose(); setReady(false); };
    // the engine is created once per session; quality is applied live below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl]);

  useEffect(() => {
    engine.current?.applyQuality(quality);
    try { localStorage.setItem("sim3d.quality", quality); } catch { /* storage unavailable */ }
  }, [quality, ready]);
  useEffect(() => { engine.current?.setSelected(tray); }, [tray, ready]);
  useEffect(() => { engine.current?.setZonesVisible(zonesOn); }, [zonesOn, ready]);

  const choiceSteps = steps.filter((x) => x.kind === "choice");
  const showSteps = mode === "guided" || mode === "practice";

  const effect = useCallback((a: Record<string, unknown>) => {
    const e = engine.current;
    if (!e) return;
    const v = String(a.value ?? "");
    if (a.kind === "position") { e.setPose(v); setPose(v); return; }
    if (a.kind === "zone") {
      lastZone.current = v;
      e.focusZone(v);
      e.addMarker(v, s.procedure.code === "S3D-BP" ? "cuff" : "hands");
      return;
    }
    if (a.kind === "equipment") { e.focus("trolley"); return; }
    if (v === "close_curtain") e.setCurtain(true);
    else if (v === "cover_patient") e.setCovered(true);
    else if (v === "apply_dressing") e.setDressing(true);
    else if (v === "inject_90" && lastZone.current) e.addMarker(lastZone.current, "needle");
    else if (v === "sharps_bin" || v === "recap_needle") e.clearMarkers();
    else if (["hand_hygiene", "wet_hands", "rinse", "apply_soap", "rub_palms", "rub_backs", "interlace", "fingertips_thumbs"].includes(v)) { e.focus("sink"); e.playWater(); }
    else if (["dry_towel", "tap_towel"].includes(v)) e.focus("sink");
    else if (["inflate_cuff", "palpate_brachial"].includes(v) && lastZone.current) e.focusZone(lastZone.current);
  }, [s.procedure.code]);

  const guide = useCallback((n: J | null) => {
    setNext(n);
    const e = engine.current;
    if (!n || !e) return;
    const t = n.target ?? {};
    if (t.kind === "zone") { e.highlight({ kind: "zone", key: t.value }); }
    else if (t.kind === "sink") { e.highlight({ kind: "object", key: "sink" }); e.focus("sink"); }
    else if (t.kind === "equipment") { setTab("tray"); e.focus("trolley"); }
    else if (t.kind === "position") setTab("patient");
    else if (t.kind === "choice") setTab("questions");
    else setTab("actions");
  }, []);

  const act = useCallback(async (a: Record<string, unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      const r: J = await sim3d.act(id, a);
      setCount((c) => c + 1);
      if (a.kind === "choice") setAnswered((x) => (r.outcome === "incorrect" && !exam ? x : [...x, String(a.step)]));
      if (r.outcome !== "incorrect" || exam) effect(a);
      if (exam) { beep("tick", sound); return; }
      const good = r.outcome === "correct" || r.outcome === "sequence" || r.outcome === "partial";
      if (good && r.step) setDoneKeys((k) => (k.includes(r.step) ? k : [...k, r.step]));
      const text = r.message ?? (r.outcome === "correct" ? "Correct." : r.outcome === "extra" ? "Not needed now." : r.outcome === "incorrect" ? "Not correct." : "");
      setFeedback({ tone: r.outcome === "unsafe" || r.outcome === "incorrect" ? "bad" : r.outcome === "extra" ? "info" : "ok", text, why: mode === "guided" ? r.rationale : undefined });
      beep(r.outcome === "unsafe" || r.outcome === "incorrect" ? "bad" : "ok", sound);
      if (r.outcome === "partial" || (a.kind === "equipment" && r.outcome === "incorrect")) {
        setFeedback({ tone: "bad", text: `${r.message} ${r.missing?.length ? `Missing: ${r.missing.map(nameOf).join(", ")}.` : ""} ${r.wrong?.length ? `Not needed: ${r.wrong.map(nameOf).join(", ")}.` : ""}`.trim() });
      }
      if (mode === "guided" && r.next !== undefined) guide(r.next);
      else if (mode === "guided") guide(null);
    } catch (e) {
      const m = friendly(e);
      toast(m, "error");
      if (/time/i.test(m)) finishRef.current();
    } finally { setBusy(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, id, exam, mode, sound, effect, guide]);

  const nameOf = (k: string) => scene.equipment.find((e) => e.key === k)?.name ?? k;

  const finish = useCallback(async (skipConfirm = false) => {
    if (finishing) return;
    if (!skipConfirm) {
      const ok = await confirm("Finish this session?", "You will see your marked checklist. Steps you have not done count as missed.", { confirmLabel: "Finish and mark" });
      if (!ok) return;
    }
    setFinishing(true);
    try { onDone(await sim3d.finish(id)); } catch (e) { toast(friendly(e), "error"); setFinishing(false); }
  }, [finishing, confirm, onDone, id, toast]);
  useEffect(() => { finishRef.current = () => { void finish(true); }; }, [finish]);

  useEffect(() => {
    if (left === null) return;
    const t = window.setInterval(() => {
      const rem = Math.max(0, Math.round(((deadline ?? 0) - (Date.now() + offset)) / 1000));
      setLeft(rem);
      if (rem <= 0) { window.clearInterval(t); finishRef.current(); }
      else if (rem <= 10) beep("tick", sound);
    }, 1000);
    return () => window.clearInterval(t);
  }, [deadline, offset, left === null, sound]); // eslint-disable-line react-hooks/exhaustive-deps

  const cam = (p: CameraPreset) => engine.current?.focus(p);
  const hint = async () => {
    try { const r = await sim3d.act(id, { kind: "hint" }); guide(r.next); if (r.next) setFeedback({ tone: "info", text: `${r.next.title}: ${r.next.instruction}` }); } catch (e) { toast(friendly(e), "error"); }
  };
  const goFull = () => { void holderRef.current?.requestFullscreen?.(); };

  const equipPick = pick?.kind === "equipment" ? scene.equipment.find((e) => e.key === pick.key) : null;
  const zonePick = pick?.kind === "zone" ? scene.zones.find((z) => z.key === pick.key) : null;
  const objAction = pick?.kind === "object" ? OBJECT_ACTION[pick.key] : undefined;

  return (
    <div className="mx-auto max-w-7xl">
      {node}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <Back to={`/sim3d/procedure/${s.procedure.id}`} label="Procedure" />
          <h1 className="truncate text-lg font-bold sm:text-xl">{s.procedure.title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={exam ? "danger" : "brand"}>{MODES.find((m) => m.id === mode)?.label}</Badge>
          {left !== null && <span className={`rounded-lg px-3 py-1 font-mono text-lg font-bold ${left <= 60 ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200" : "surface-2"}`} role="timer" aria-live="off">{mmss(left)}</span>}
          <Button variant="primary" loading={finishing} onClick={() => finish()}>Finish</Button>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div ref={holderRef} className="relative h-[52vh] min-h-[320px] overflow-hidden rounded-2xl border line bg-slate-200 lg:h-[calc(100vh-200px)] lg:min-h-[520px] dark:bg-slate-800">
          {gl && !failed && <canvas ref={canvasRef} tabIndex={0} className="block h-full w-full touch-none outline-none" aria-label="Interactive 3D ward. Drag to rotate, scroll or pinch to zoom, arrow keys to move the view. Use the panel for the same actions." />}
          {!ready && !failed && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-100/90 p-6 dark:bg-slate-900/90">
              <Icon name="cube" size={30} className="text-brand-600" />
              <div className="text-sm font-medium">{loadPct.label}…</div>
              <div className="w-56"><ProgressBar value={loadPct.pct} label="Loading the ward" /></div>
            </div>
          )}
          {failed && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
              <Icon name="alert" size={28} className="text-amber-600" />
              <div className="font-semibold">3D view is not available on this device</div>
              <p className="ink-2 max-w-sm text-sm">You can still complete the whole procedure and be marked using the panel on the right: choose equipment, position the patient, select sites and perform each action.</p>
            </div>
          )}
          {ready && (
            <>
              <div className="absolute left-2 top-2 flex max-w-[70%] flex-wrap gap-1">
                {PRESET_BUTTONS.map(([k, l]) => <button key={k} onClick={() => cam(k)} className="rounded-md bg-white/90 px-2 py-1 text-xs font-medium text-slate-800 shadow hover:bg-white dark:bg-slate-900/90 dark:text-slate-100">{l}</button>)}
              </div>
              <div className="absolute right-2 top-2 flex flex-col items-end gap-1">
                <select aria-label="Graphics quality" value={quality} onChange={(e) => setQuality(e.target.value as Quality)} className="rounded-md bg-white/90 px-2 py-1 text-xs text-slate-800 shadow dark:bg-slate-900/90 dark:text-slate-100">
                  <option value="low">Low quality</option><option value="medium">Medium quality</option><option value="high">High quality</option>
                </select>
                <button onClick={() => setSound((x) => !x)} aria-pressed={sound} className="rounded-md bg-white/90 px-2 py-1 text-xs text-slate-800 shadow dark:bg-slate-900/90 dark:text-slate-100"><Icon name="volume" size={14} className="mr-1 inline" />{sound ? "Sound on" : "Sound off"}</button>
                <button onClick={goFull} className="rounded-md bg-white/90 px-2 py-1 text-xs text-slate-800 shadow dark:bg-slate-900/90 dark:text-slate-100">Full screen</button>
              </div>
              {hover && <div className="pointer-events-none fixed z-30 rounded-md bg-slate-900/90 px-2 py-1 text-xs text-white" style={{ left: hover.x + 12, top: hover.y + 12 }}>{hover.p.label}</div>}
              {feedback && (
                <div role="status" className={`absolute bottom-2 left-2 right-2 rounded-xl border p-3 text-sm shadow-lg ${feedback.tone === "bad" ? "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100" : feedback.tone === "ok" ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100" : "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100"}`}>
                  <div className="flex items-start justify-between gap-2"><div><span className="font-semibold">{feedback.text}</span>{feedback.why && <span className="mt-0.5 block text-xs opacity-90">{feedback.why}</span>}</div>
                    <button onClick={() => setFeedback(null)} aria-label="Dismiss" className="shrink-0 opacity-70 hover:opacity-100"><Icon name="x" size={16} /></button></div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="min-w-0">
          {pick && (
            <Card className="mb-3">
              <div className="flex items-start justify-between gap-2"><h2 className="font-semibold">{pick.label}</h2><button onClick={() => { setPick(null); engine.current?.highlight(null); }} aria-label="Close details" className="ink-2"><Icon name="x" size={16} /></button></div>
              {equipPick && (exam ? <p className="ink-2 mt-1 text-sm">Tap Add to put this on your tray.</p> : <div className="mt-2"><EquipInfo e={equipPick} /></div>)}
              {equipPick && (
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={() => setTray((t) => (t.includes(equipPick.key) ? t.filter((x) => x !== equipPick.key) : [...t, equipPick.key]))}>{tray.includes(equipPick.key) ? "Remove from tray" : "Add to tray"}</Button>
                </div>
              )}
              {zonePick && <p className="ink-2 mt-1 text-sm">{exam ? "Select this as the site?" : zonePick.explain}</p>}
              {zonePick && <div className="mt-3"><Button size="sm" loading={busy} onClick={() => act({ kind: "zone", value: zonePick.key })}>Select this site</Button></div>}
              {pick.kind === "object" && <p className="ink-2 mt-1 text-sm">{exam ? "" : OBJECT_TEXT[pick.key] ?? ""}</p>}
              {pick.kind === "object" && objAction && scene.actions.some((a) => a.key === objAction) && (
                <div className="mt-3"><Button size="sm" loading={busy} onClick={() => act({ kind: "object", value: objAction })}>{scene.actions.find((a) => a.key === objAction)?.label}</Button></div>
              )}
            </Card>
          )}
          <Tabs<PanelTab> tabs={[{ id: "task", label: "Task" }, { id: "tray", label: `Tray${tray.length ? ` (${tray.length})` : ""}` }, { id: "patient", label: "Patient" }, { id: "actions", label: "Actions" }, ...(choiceSteps.length ? [{ id: "questions" as const, label: "Questions" }] : [])]} value={tab} onChange={setTab} />

          {tab === "task" && (
            <Card className="space-y-3 text-sm">
              {mode === "guided" && next && (
                <div className="rounded-lg border border-brand-300 bg-brand-50 p-3 dark:border-brand-700 dark:bg-brand-900/40">
                  <div className="text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-200">Next step</div>
                  <div className="font-semibold">{next.title}</div>
                  <div className="ink-2">{next.instruction}</div>
                </div>
              )}
              {mode === "guided" && !next && <p className="ink-2">Start with hand hygiene, or press Next step.</p>}
              {mode === "guided" && <Button size="sm" variant="secondary" onClick={() => guide(next)}>Show me where</Button>}
              {mode === "practice" && <Button size="sm" variant="secondary" onClick={hint}>Hint</Button>}
              {exam && <p className="ink-2">Work through the whole procedure as you would in the examination. Nothing is marked until you finish. Use the Tray tab to choose equipment, then position the patient, select sites and perform actions.</p>}
              <div className="ink-2 text-xs">{count} action{count === 1 ? "" : "s"} so far</div>
              {showSteps && (
                <div>
                  <h3 className="mb-1 font-semibold">Procedure steps</h3>
                  <ol className="space-y-1">
                    {steps.map((x, i) => {
                      const done = doneKeys.includes(x.key);
                      return <li key={x.key} className="flex items-start gap-2"><span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ${done ? "bg-emerald-600 text-white" : "surface-2 ink-2"}`}>{done ? <Icon name="check" size={12} /> : i + 1}</span><span className={done ? "ink-2 line-through" : ""}>{x.title}</span></li>;
                    })}
                  </ol>
                </div>
              )}
              <List title="Safety points" items={s.procedure.safety} />
            </Card>
          )}

          {tab === "tray" && (
            <Card>
              <p className="ink-2 mb-3 text-sm">Choose what you need for this procedure. Tap an item on the trolley to inspect it, or tick it here. Then confirm your tray.</p>
              <div className="space-y-1.5">
                {scene.equipment.map((e) => (
                  <label key={e.key} className="flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-sm line">
                    <input type="checkbox" checked={tray.includes(e.key)} onChange={() => setTray((t) => (t.includes(e.key) ? t.filter((x) => x !== e.key) : [...t, e.key]))} />
                    <span className="flex-1">{e.name}</span>
                    <button type="button" className="text-xs text-brand-700 underline dark:text-brand-300" onClick={(ev) => { ev.preventDefault(); const info = { kind: "equipment" as const, key: e.key, label: e.name }; setPick(info); engine.current?.highlight(info); }}>Inspect</button>
                  </label>
                ))}
              </div>
              <Button className="mt-3 w-full" loading={busy} disabled={!tray.length} onClick={() => act({ kind: "equipment", items: tray })}>Confirm tray</Button>
            </Card>
          )}

          {tab === "patient" && (
            <Card className="space-y-4">
              <div>
                <h3 className="mb-1 text-sm font-semibold">Position the patient</h3>
                <div className="grid grid-cols-2 gap-2">
                  {scene.positions.map((p) => (
                    <button key={p.key} title={exam ? undefined : p.why} onClick={() => act({ kind: "position", value: p.key })} className={`rounded-lg border p-2 text-left text-sm line ${pose === p.key ? "border-brand-500 bg-brand-50 dark:bg-brand-900/40" : "hover:border-brand-400"} ${next?.target?.kind === "position" && next.target.value === p.key ? "ring-2 ring-amber-400" : ""}`}>
                      <div className="font-medium">{p.label}</div>{!exam && <div className="ink-2 text-xs">{p.why}</div>}
                    </button>
                  ))}
                  {!scene.positions.length && <p className="ink-2 col-span-2 text-sm">No positioning is needed for this procedure.</p>}
                </div>
              </div>
              {scene.zones.length > 0 && (
                <div>
                  <div className="mb-1 flex items-center justify-between"><h3 className="text-sm font-semibold">Body areas</h3>
                    <label className="ink-2 flex items-center gap-1 text-xs"><input type="checkbox" checked={zonesOn} onChange={(e) => setZonesOn(e.target.checked)} />Show markers</label></div>
                  <div className="space-y-1.5">
                    {scene.zones.map((z) => (
                      <div key={z.key} className={`flex items-center justify-between gap-2 rounded-lg border p-2 text-sm line ${next?.target?.kind === "zone" && next.target.value === z.key ? "ring-2 ring-amber-400" : ""}`}>
                        <button className="min-w-0 flex-1 text-left" onClick={() => { const info = { kind: "zone" as const, key: z.key, label: z.label }; setPick(info); engine.current?.highlight(info); engine.current?.focusZone(z.key); }}>{z.label}</button>
                        <Button size="sm" variant="secondary" disabled={busy} onClick={() => act({ kind: "zone", value: z.key })}>Select</Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          )}

          {tab === "actions" && (
            <Card className="space-y-4">
              {(["care", "technique"] as const).map((g) => (
                <div key={g}>
                  <h3 className="mb-1 text-sm font-semibold">{g === "care" ? "Care and communication" : "Technique"}</h3>
                  <div className="space-y-1.5">
                    {scene.actions.filter((a) => a.group === g).map((a) => (
                      <button key={a.key} disabled={busy} onClick={() => act({ kind: "object", value: a.key })} className={`w-full rounded-lg border p-2 text-left text-sm line hover:border-brand-400 disabled:opacity-60 ${next?.target?.kind === "object" && next.target.value === a.key ? "ring-2 ring-amber-400" : ""}`}>{a.label}</button>
                    ))}
                  </div>
                </div>
              ))}
            </Card>
          )}

          {tab === "questions" && (
            <div className="space-y-3">
              {choiceSteps.map((c) => <ChoiceCard key={c.key} step={c} locked={answered.includes(c.key)} onAnswer={(opt) => act({ kind: "choice", step: c.key, value: opt })} busy={busy} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ChoiceCard({ step, locked, onAnswer, busy }: { step: J; locked: boolean; onAnswer: (id: string) => void; busy: boolean }) {
  const [sel, setSel] = useState("");
  return (
    <Card>
      <h3 className="font-semibold">{step.title}</h3>
      {step.instruction && <p className="ink-2 mt-1 text-sm">{step.instruction}</p>}
      <p className="mt-2 text-sm font-medium">{step.prompt}</p>
      <div className="mt-2 space-y-1.5">
        {step.options.map((o: J) => (
          <label key={o.id} className="flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm line">
            <input type="radio" name={step.key} checked={sel === o.id} disabled={locked} onChange={() => setSel(o.id)} className="mt-1" />{o.text}
          </label>
        ))}
      </div>
      <Button className="mt-3" size="sm" disabled={!sel || locked} loading={busy} onClick={() => onAnswer(sel)}>{locked ? "Answered" : "Submit answer"}</Button>
    </Card>
  );
}
