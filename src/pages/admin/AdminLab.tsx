import { lazy, Suspense, useState } from "react";
import { useAsync } from "../../lib/useAsync";
import { friendly } from "../../lib/errors";
import { supabase } from "../../lib/supabase";
import { rpc } from "../../lib/api";
import { labAdmin, type J } from "../../lib/lab";
import { useAuth } from "../../auth/AuthProvider";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Loading, PageHeader, Select, Stat, Tabs, Textarea, useConfirm, useToast } from "../../components/ui";

type Tab = "review" | "viva" | "procedures" | "videos" | "content" | "analytics" | "sim3d";
const AdminSim3D = lazy(() => import("./AdminSim3D"));
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const tone = (s: string) => (s === "published" ? "success" : s === "draft" ? "warning" : "neutral") as "success" | "warning" | "neutral";

function PublishButtons({ table, row, reviewer, onDone }: { table: string; row: J; reviewer: string; onDone: () => void }) {
  const toast = useToast();
  const run = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok, "success"); onDone(); } catch (e) { toast(friendly(e), "error"); } };
  return row.status === "published"
    ? <Button size="sm" variant="secondary" onClick={() => run(() => labAdmin.unpublish(table, row.id), "Unpublished")}>Unpublish</Button>
    : <Button size="sm" onClick={() => run(() => labAdmin.publish(table, row.id, reviewer), "Published")}>Publish</Button>;
}

// ------------------------------------------------------------ Review
function ReviewTab({ reviewer, setReviewer }: { reviewer: string; setReviewer: (s: string) => void }) {
  const toast = useToast(); const { confirm, confirmNode } = useConfirm(); const { can } = useAuth();
  const counts = useAsync(async () => {
    const t = ["viva_cases", "caosce_procedures", "caosce_questions", "caosce_exams", "caosce_exercises", "caosce_videos", "clinical_stations"];
    const out: Record<string, { draft: number; published: number }> = {};
    for (const n of t) {
      const [d, p] = await Promise.all([
        supabase.from(n).select("id", { count: "exact", head: true }).neq("status", "published"),
        supabase.from(n).select("id", { count: "exact", head: true }).eq("status", "published")]);
      out[n] = { draft: d.count ?? 0, published: p.count ?? 0 };
    }
    return out;
  }, []);
  const publishAll = async (area: "viva" | "caosce") => {
    if (!reviewer.trim()) return toast("Enter the reviewing tutor's name first.", "error");
    if (!(await confirm(`Publish all ${area} content?`, `This makes every ${area} item that has the required fields visible to students, recorded as reviewed by ${reviewer}. Only do this after a tutor has checked the content.`, { confirmLabel: "Publish" }))) return;
    try { const r = await labAdmin.publishAll(area, reviewer.trim()); toast(`Published ${r.published_items} items.`, "success"); counts.reload(); } catch (e) { toast(friendly(e), "error"); }
  };
  return (
    <div className="space-y-4">
      {confirmNode}
      <Card>
        <h2 className="mb-1 font-semibold">Tutor review and publishing</h2>
        <p className="ink-2 mb-3 text-sm">Nothing reaches students until it is published. Procedures need steps, a source reference and a reviewer's name. Keep the reviewer's name accurate: it is shown to students.</p>
        <Field label="Reviewing tutor (name and title)">{(id) => <Input id={id} value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="e.g. Mrs A. Okafor, Nurse Tutor" />}</Field>
        {can("content.review") ? <div className="mt-3 flex flex-wrap gap-2"><Button onClick={() => publishAll("viva")}>Publish all viva content</Button><Button onClick={() => publishAll("caosce")}>Publish all CAOSCE content</Button></div>
          : <p className="mt-3 text-sm text-amber-700">You need the content.review permission to publish.</p>}
      </Card>
      {counts.loading ? <Loading /> : counts.data && <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{Object.entries(counts.data).map(([k, v]) => <Stat key={k} label={k.replace(/_/g, " ")} value={`${v.published} live`} hint={`${v.draft} not published`} />)}</div>}
    </div>
  );
}

// ------------------------------------------------------------ Viva
function KeyPointRow({ kp, onSaved }: { kp: J; onSaved: () => void }) {
  const toast = useToast();
  const [point, setPoint] = useState(kp.point as string);
  const [acc, setAcc] = useState((kp.accepted as string[]).join("\n"));
  const [marks, setMarks] = useState(String(kp.marks));
  const [crit, setCrit] = useState(Boolean(kp.is_critical));
  const save = async () => {
    const { error } = await supabase.from("viva_key_points").update({ point, accepted: lines(acc), marks: Number(marks) || 1, is_critical: crit }).eq("id", kp.id);
    if (error) toast(friendly(error), "error"); else { toast("Saved", "success"); onSaved(); }
  };
  return (
    <div className="surface-2 mb-2 rounded-lg p-2">
      <Input value={point} onChange={(e) => setPoint(e.target.value)} aria-label="Key point" />
      <Textarea rows={2} value={acc} onChange={(e) => setAcc(e.target.value)} className="mt-1" aria-label="Accepted wordings" placeholder="Other accepted wordings, one per line (everyday or local English)" />
      <div className="mt-1 flex items-center gap-3 text-sm"><Input className="w-20" type="number" min={0.5} step={0.5} value={marks} onChange={(e) => setMarks(e.target.value)} aria-label="Marks" />
        <label className="flex items-center gap-1"><input type="checkbox" checked={crit} onChange={(e) => setCrit(e.target.checked)} />Critical</label><Button size="sm" onClick={save}>Save</Button></div>
    </div>
  );
}

function VivaTab({ reviewer }: { reviewer: string }) {
  const toast = useToast();
  const cases = useAsync(async () => (await supabase.from("viva_cases").select("id,title,status,programme,viva_categories(name)").order("created_at")).data ?? [], []);
  const [open, setOpen] = useState<string | null>(null);
  const qs = useAsync(async () => open ? (await supabase.from("viva_questions").select("id,prompt,marks,model_answer,explanation,position,viva_key_points(id,point,accepted,marks,is_critical,position)").eq("case_id", open).order("position")).data ?? [] : [], [open]);
  const [blob, setBlob] = useState("");
  const imp = async () => { try { const r = await rpc<J>("lab_import_viva", { p_blob: blob }); toast(`Imported ${r.cases} cases, ${r.questions} questions, ${r.points} key points`, "success"); setBlob(""); cases.reload(); } catch (e) { toast(friendly(e), "error"); } };
  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-2 font-semibold">Viva cases</h2>
        {cases.loading ? <Loading /> : (cases.data ?? []).map((c: J) => (
          <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2 line last:border-0">
            <div><div className="text-sm font-medium">{c.title}</div><div className="ink-2 text-xs">{c.viva_categories?.name} · {c.programme}</div></div>
            <div className="flex items-center gap-2"><Badge tone={tone(c.status)}>{c.status}</Badge><Button size="sm" variant="ghost" onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? "Close" : "Edit marking"}</Button><PublishButtons table="viva_cases" row={c} reviewer={reviewer} onDone={cases.reload} /></div>
            {open === c.id && <div className="w-full">{qs.loading ? <Loading /> : (qs.data ?? []).map((q: J) => (
              <div key={q.id} className="mb-3 rounded-lg border p-3 line"><div className="text-sm font-semibold">{q.prompt} <span className="ink-2">({q.marks} marks)</span></div><p className="ink-2 mb-2 text-xs">Model answer: {q.model_answer}</p>
                {[...q.viva_key_points].sort((a: J, b: J) => a.position - b.position).map((k: J) => <KeyPointRow key={k.id} kp={k} onSaved={qs.reload} />)}</div>))}</div>}
          </div>))}
      </Card>
      <Card>
        <h2 className="mb-1 font-semibold">Bulk import</h2>
        <p className="ink-2 mb-2 text-xs">One line per item. CASE|category_slug|programme|title|intro|difficulty|free(0/1) then Q|prompt|marks|model_answer|explanation|unsafe;;unsafe then P|key point|accepted;;accepted|marks|critical(0/1)</p>
        <Textarea rows={6} value={blob} onChange={(e) => setBlob(e.target.value)} /><Button className="mt-2" onClick={imp} disabled={!blob.trim()}>Import as draft</Button>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------ Procedures
function ProcedureEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const toast = useToast(); const { confirm, confirmNode } = useConfirm();
  const p = useAsync(async () => {
    const [a, b] = await Promise.all([supabase.from("caosce_procedures").select("*").eq("id", id).single(),
      supabase.from("caosce_procedure_steps").select("*").eq("procedure_id", id).order("position")]);
    return { p: a.data as J, steps: (b.data ?? []) as J[] };
  }, [id]);
  const [f, setF] = useState<J>(null);
  if (p.loading) return <Loading />;
  if (!p.data) return <ErrorBox message={p.error ?? "Not found"} />;
  const cur = f ?? { ...p.data.p, objectives: p.data.p.objectives.join("\n"), indications: p.data.p.indications.join("\n"), contraindications: p.data.p.contraindications.join("\n"),
    expected_outcomes: p.data.p.expected_outcomes.join("\n"), safety: p.data.p.safety.join("\n"), source_references: p.data.p.source_references.join("\n") };
  const set = (k: string, v: string) => setF({ ...cur, [k]: v });
  const saveMain = async () => {
    const { error } = await supabase.from("caosce_procedures").update({ name: cur.name, description: cur.description, definition: cur.definition, purpose: cur.purpose, anatomy: cur.anatomy,
      objectives: lines(cur.objectives), indications: lines(cur.indications), contraindications: lines(cur.contraindications), expected_outcomes: lines(cur.expected_outcomes),
      safety: lines(cur.safety), source_references: lines(cur.source_references), reviewer: cur.reviewer || null }).eq("id", id);
    if (error) toast(friendly(error), "error"); else { toast("Saved", "success"); p.reload(); }
  };
  const addStep = async () => { const { error } = await supabase.from("caosce_procedure_steps").insert({ procedure_id: id, position: p.data!.steps.length + 1, action: "New step" }); if (error) toast(friendly(error), "error"); else p.reload(); };
  const delStep = async (sid: string) => { if (!(await confirm("Delete this step?", "This cannot be undone.", { danger: true, confirmLabel: "Delete" }))) return; const { error } = await supabase.from("caosce_procedure_steps").delete().eq("id", sid); if (error) toast(friendly(error), "error"); else p.reload(); };
  const move = async (i: number, d: number) => { const ids = p.data!.steps.map((s) => s.id); const j = i + d; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; try { await labAdmin.reorder("caosce_procedure_steps", ids); p.reload(); } catch (e) { toast(friendly(e), "error"); } };
  const T = (k: string, label: string, rows = 2) => <Field label={label}>{(fid) => <Textarea id={fid} rows={rows} value={cur[k] ?? ""} onChange={(e) => set(k, e.target.value)} />}</Field>;
  return (
    <Card>
      {confirmNode}
      <div className="mb-3 flex justify-between"><h2 className="font-semibold">Edit procedure (version {p.data.p.version})</h2><Button size="sm" variant="ghost" onClick={onClose}>Close</Button></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">{(fid) => <Input id={fid} value={cur.name} onChange={(e) => set("name", e.target.value)} />}</Field>
        <Field label="Reviewed by (tutor)">{(fid) => <Input id={fid} value={cur.reviewer ?? ""} onChange={(e) => set("reviewer", e.target.value)} />}</Field>
        {T("description", "Short description")}{T("definition", "Definition")}{T("purpose", "Purpose")}{T("anatomy", "Relevant anatomy")}
        {T("objectives", "Objectives (one per line)", 3)}{T("indications", "Indications (one per line)", 3)}{T("contraindications", "Contraindications (one per line)", 3)}
        {T("expected_outcomes", "Expected outcomes (one per line)", 3)}{T("safety", "Safety points (one per line)", 3)}{T("source_references", "Source references (one per line, required to publish)", 3)}
      </div>
      <Button className="mt-3" onClick={saveMain}>Save details</Button>
      <h3 className="mb-2 mt-6 font-semibold">Steps</h3>
      {p.data.steps.map((s, i) => <StepRow key={s.id + s.updated_at} s={s} i={i} onMove={move} onDelete={delStep} onSaved={p.reload} />)}
      <Button variant="secondary" size="sm" icon="plus" onClick={addStep}>Add step</Button>
    </Card>
  );
}
function StepRow({ s, i, onMove, onDelete, onSaved }: { s: J; i: number; onMove: (i: number, d: number) => void; onDelete: (id: string) => void; onSaved: () => void }) {
  const toast = useToast(); const [f, setF] = useState<J>({ ...s });
  const set = (k: string, v: string | boolean) => setF({ ...f, [k]: v });
  const save = async () => {
    const { error } = await supabase.from("caosce_procedure_steps").update({ action: f.action, explanation: f.explanation || null, rationale: f.rationale || null, safety: f.safety || null,
      common_mistake: f.common_mistake || null, expected_outcome: f.expected_outcome || null, is_critical: f.is_critical }).eq("id", s.id);
    if (error) toast(friendly(error), "error"); else { toast("Saved", "success"); onSaved(); }
  };
  return (
    <div className="surface-2 mb-2 rounded-lg p-3">
      <div className="mb-1 flex items-center gap-2"><b className="text-sm">{i + 1}</b><Input value={f.action} onChange={(e) => set("action", e.target.value)} aria-label="Action" />
        <Button size="sm" variant="ghost" aria-label="Up" onClick={() => onMove(i, -1)}>↑</Button><Button size="sm" variant="ghost" aria-label="Down" onClick={() => onMove(i, 1)}>↓</Button></div>
      <div className="grid gap-2 sm:grid-cols-2">{(["explanation", "rationale", "safety", "common_mistake", "expected_outcome"] as const).map((k) => <Textarea key={k} rows={2} value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} placeholder={k.replace("_", " ")} aria-label={k} />)}</div>
      <div className="mt-2 flex items-center gap-3 text-sm"><label className="flex items-center gap-1"><input type="checkbox" checked={f.is_critical} onChange={(e) => set("is_critical", e.target.checked)} />Critical step</label>
        <Button size="sm" onClick={save}>Save step</Button><Button size="sm" variant="danger" onClick={() => onDelete(s.id)}>Delete</Button></div>
    </div>
  );
}

function ProceduresTab({ reviewer }: { reviewer: string }) {
  const toast = useToast();
  const list = useAsync(async () => (await supabase.from("caosce_procedures").select("id,code,name,status,programme,version,reviewer,station_id").order("position")).data ?? [], []);
  const [edit, setEdit] = useState<string | null>(null);
  if (edit) return <ProcedureEditor id={edit} onClose={() => { setEdit(null); list.reload(); }} />;
  return (
    <Card>
      <h2 className="mb-2 font-semibold">Procedures</h2>
      {list.loading ? <Loading /> : (list.data ?? []).map((p: J) => (
        <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2 line last:border-0">
          <div><div className="text-sm font-medium">{p.name}</div><div className="ink-2 text-xs">{p.code} · {p.programme} · v{p.version}{p.reviewer ? ` · ${p.reviewer}` : " · no reviewer"}</div></div>
          <div className="flex flex-wrap items-center gap-2"><Badge tone={tone(p.status)}>{p.status}</Badge><Button size="sm" variant="secondary" onClick={() => setEdit(p.id)}>Edit</Button>
            <Button size="sm" variant="ghost" onClick={async () => { try { await labAdmin.duplicate(p.id); toast("Duplicated as a draft", "success"); list.reload(); } catch (e) { toast(friendly(e), "error"); } }}>Duplicate</Button>
            <PublishButtons table="caosce_procedures" row={p} reviewer={reviewer} onDone={list.reload} /></div>
        </div>))}
    </Card>
  );
}

// ------------------------------------------------------------ Videos
function VideosTab({ reviewer }: { reviewer: string }) {
  const toast = useToast();
  const procs = useAsync(async () => (await supabase.from("caosce_procedures").select("id,name").order("name")).data ?? [], []);
  const vids = useAsync(async () => (await supabase.from("caosce_videos").select("id,title,kind,status,storage_path,external_url,caosce_procedures(name)").order("created_at", { ascending: false })).data ?? [], []);
  const [f, setF] = useState({ procedure_id: "", kind: "complete", title: "", external_url: "", description: "", transcript: "" });
  const [file, setFile] = useState<File | null>(null);
  const [cap, setCap] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!f.procedure_id || !f.title.trim()) return toast("Choose a procedure and give the video a title.", "error");
    if (!file && !f.external_url.trim()) return toast("Upload a video file or paste a link.", "error");
    setBusy(true);
    try {
      let path: string | null = null, capPath: string | null = null;
      if (file) { path = `videos/${f.procedure_id}/${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`; const { error } = await supabase.storage.from("lab-media").upload(path, file, { contentType: file.type }); if (error) throw error; }
      if (cap) { capPath = `captions/${f.procedure_id}/${Date.now()}-${cap.name.replace(/[^\w.-]/g, "_")}`; const { error } = await supabase.storage.from("lab-media").upload(capPath, cap, { contentType: "text/vtt" }); if (error) throw error; }
      const { error } = await supabase.from("caosce_videos").insert({ procedure_id: f.procedure_id, kind: f.kind, title: f.title.trim(), description: f.description || null, transcript: f.transcript || null, storage_path: path, external_url: f.external_url.trim() || null, captions_path: capPath });
      if (error) throw error;
      toast("Video added as a draft. Publish it after a qualified instructor has checked it.", "success"); setF({ ...f, title: "", external_url: "", description: "", transcript: "" }); setFile(null); setCap(null); vids.reload();
    } catch (e) { toast(friendly(e), "error"); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-2 font-semibold">Add a demonstration video</h2>
        <p className="ink-2 mb-3 text-xs">Use real recordings made by qualified instructors. MP4/WebM up to 50 MB, or paste a link. Add captions (.vtt) and a transcript for accessibility.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Procedure">{(id) => <Select id={id} value={f.procedure_id} onChange={(e) => setF({ ...f, procedure_id: e.target.value })}><option value="">Choose</option>{(procs.data ?? []).map((p: J) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>}</Field>
          <Field label="Type">{(id) => <Select id={id} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{["complete", "step_by_step", "mistakes", "equipment", "other"].map((k) => <option key={k} value={k}>{k.replace("_", " ")}</option>)}</Select>}</Field>
          <Field label="Title">{(id) => <Input id={id} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
          <Field label="Or video link (YouTube, Vimeo or direct)">{(id) => <Input id={id} value={f.external_url} onChange={(e) => setF({ ...f, external_url: e.target.value })} />}</Field>
          <Field label="Video file">{(id) => <input id={id} type="file" accept="video/mp4,video/webm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}</Field>
          <Field label="Captions (.vtt)">{(id) => <input id={id} type="file" accept=".vtt,text/vtt" onChange={(e) => setCap(e.target.files?.[0] ?? null)} />}</Field>
          <Field label="Description">{(id) => <Textarea id={id} rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
          <Field label="Transcript">{(id) => <Textarea id={id} rows={2} value={f.transcript} onChange={(e) => setF({ ...f, transcript: e.target.value })} />}</Field>
        </div>
        <Button className="mt-3" icon="upload" loading={busy} onClick={add}>Add video</Button>
      </Card>
      <Card><h2 className="mb-2 font-semibold">Videos</h2>
        {vids.loading ? <Loading /> : (vids.data ?? []).length === 0 ? <EmptyState icon="video" title="No videos yet">Record the procedures with a qualified instructor and add them above.</EmptyState> : (vids.data ?? []).map((v: J) => (
          <div key={v.id} className="flex items-center justify-between gap-2 border-b py-2 line last:border-0"><div><div className="text-sm font-medium">{v.title}</div><div className="ink-2 text-xs">{v.caosce_procedures?.name} · {v.kind}</div></div>
            <div className="flex items-center gap-2"><Badge tone={tone(v.status)}>{v.status}</Badge><PublishButtons table="caosce_videos" row={v} reviewer={reviewer} onDone={vids.reload} /></div></div>))}</Card>
    </div>
  );
}

// ------------------------------------------------------------ Questions, exercises, exams
function ContentTab({ reviewer }: { reviewer: string }) {
  const [t, setT] = useState("caosce_exams");
  const cols: Record<string, string> = { caosce_exams: "id,title,status", caosce_questions: "id,stem,status", caosce_exercises: "id,title,status", caosce_equipment: "id,name,status" };
  const list = useAsync(async () => (await supabase.from(t).select(cols[t]).order("created_at").limit(200)).data ?? [], [t]);
  return (
    <Card>
      <Tabs tabs={[{ id: "caosce_exams", label: "Exams" }, { id: "caosce_questions", label: "Questions" }, { id: "caosce_exercises", label: "Exercises" }, { id: "caosce_equipment", label: "Equipment" }]} value={t} onChange={setT} />
      {list.loading ? <Loading /> : (list.data as unknown as J[]).map((r) => (
        <div key={r.id} className="flex items-center justify-between gap-2 border-b py-2 line last:border-0"><span className="min-w-0 truncate text-sm">{r.title ?? r.stem ?? r.name}</span>
          <div className="flex items-center gap-2"><Badge tone={tone(r.status)}>{r.status}</Badge><PublishButtons table={t} row={r} reviewer={reviewer} onDone={list.reload} /></div></div>))}
      <p className="ink-2 mt-3 text-xs">Exam stations and timings can be adjusted in the database tables caosce_exams and caosce_exam_stations. Question stations draw random published questions.</p>
    </Card>
  );
}

// ------------------------------------------------------------ Analytics
function AnalyticsTab() {
  const a = useAsync(() => labAdmin.analytics(), []);
  if (a.loading) return <Loading />;
  if (a.error || !a.data) return <ErrorBox message={a.error ?? ""} onRetry={a.reload} />;
  const v: J = a.data.viva, c: J = a.data.caosce;
  const L = ({ title, rows, f }: { title: string; rows: J[]; f: (r: J) => string }) => <Card><h3 className="mb-2 font-semibold">{title}</h3>{rows.length === 0 ? <p className="ink-2 text-sm">No data yet.</p> : <ul className="space-y-1 text-sm">{rows.map((r, i) => <li key={i}>{f(r)}</li>)}</ul>}</Card>;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Stat label="Viva students" value={v.active_students} /><Stat label="Viva sessions" value={v.sessions} /><Stat label="Viva average" value={v.avg_percent != null ? `${v.avg_percent}%` : "-"} /><Stat label="Mock exam average" value={c.exam_avg != null ? `${c.exam_avg}%` : "-"} /></div>
      <div className="grid gap-4 lg:grid-cols-2">
        <L title="Hardest viva questions" rows={v.hardest_questions} f={(r) => `${r.percent}% · ${r.prompt}`} />
        <L title="Most-missed viva points" rows={v.common_misses} f={(r) => `${r.times}× ${r.point}`} />
        <L title="Popular viva topics" rows={v.popular_categories} f={(r) => `${r.answers} answers · ${r.category}`} />
        <L title="Most studied procedures" rows={c.studied} f={(r) => `${r.students} students · ${r.procedure}`} />
        <L title="Least studied procedures" rows={c.least_studied} f={(r) => `${r.students} students · ${r.procedure}`} />
        <L title="Lowest-scoring stations" rows={c.failed_stations} f={(r) => `${r.percent}% · ${r.station} (${r.attempts})`} />
        <L title="Most-missed checklist steps" rows={c.missed_items} f={(r) => `${r.times}× ${r.step}`} />
        <L title="Most-watched videos" rows={c.watched_videos} f={(r) => `${r.viewers} viewers · ${r.video}`} />
        <L title="By programme" rows={c.by_programme} f={(r) => `${r.programme}: ${r.attempts} attempts, average ${r.avg ?? "-"}%`} />
      </div>
    </div>
  );
}

export default function AdminLab() {
  const [tab, setTab] = useState<Tab>("review");
  const [reviewer, setReviewer] = useState("");
  return (
    <div>
      <PageHeader title="Viva and CAOSCE lab" subtitle="Review, edit and publish clinical practice content. Content is for revision and always needs tutor review." />
      <Tabs<Tab> tabs={[{ id: "review", label: "Review & publish" }, { id: "viva", label: "Viva" }, { id: "procedures", label: "Procedures" }, { id: "videos", label: "Videos" }, { id: "content", label: "Exams & questions" }, { id: "analytics", label: "Analytics" }, { id: "sim3d", label: "3D lab" }]} value={tab} onChange={setTab} />
      {tab === "review" && <ReviewTab reviewer={reviewer} setReviewer={setReviewer} />}
      {tab === "viva" && <VivaTab reviewer={reviewer} />}
      {tab === "procedures" && <ProceduresTab reviewer={reviewer} />}
      {tab === "videos" && <VideosTab reviewer={reviewer} />}
      {tab === "content" && <ContentTab reviewer={reviewer} />}
      {tab === "analytics" && <AnalyticsTab />}
      {tab === "sim3d" && <Suspense fallback={<Loading />}><AdminSim3D /></Suspense>}
    </div>
  );
}
