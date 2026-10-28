import { useState } from "react";
import { Icon } from "../../components/Icon";
import { Badge, Button, Card, DemoBadge, EmptyState, ErrorBox, Input, Loading, PageHeader, StatusBadge, Textarea, useToast } from "../../components/ui";
import { friendly } from "../../lib/errors";
import { Link, useNavigate, useParams } from "../../lib/router";
import { supabase } from "../../lib/supabase";
import type { PublicationStatus } from "../../lib/types";
import { useAsync } from "../../lib/useAsync";
import { type FieldDef, FormModal, must, ReorderButtons } from "./adminKit";

interface Station { id: string; bank: string; kind: "viva" | "caosce"; title: string; scenario: string; candidate_instructions: string | null; examiner_notes: string | null; duration_minutes: number; status: PublicationStatus; source_reference: string | null; is_demo: boolean }

const FIELDS: FieldDef[] = [
  { key: "title", label: "Title", required: true },
  { key: "kind", label: "Type", type: "select", options: [["viva", "Viva"], ["caosce", "CAOSCE-style procedure"]] },
  { key: "bank", label: "Available in", type: "select", options: [["practice", "Free practice"], ["section_c", "Section C (paid)"], ["section_d", "Section D (paid)"]] },
  { key: "scenario", label: "Scenario (Markdown)", type: "textarea", required: true },
  { key: "candidate_instructions", label: "Candidate instructions", type: "textarea" },
  { key: "examiner_notes", label: "Examiner notes (shown only after the attempt)", type: "textarea" },
  { key: "duration_minutes", label: "Duration (minutes)", type: "number" },
  { key: "source_reference", label: "Source / reference" },
  { key: "status", label: "Status", type: "select", options: [["draft", "Draft"], ["in_review", "In review"], ["published", "Published"], ["unpublished", "Unpublished"], ["archived", "Archived"]] },
  { key: "is_demo", label: "Demonstration content", type: "checkbox" },
];

export default function AdminStations() {
  const { id } = useParams<{ id?: string }>();
  return id ? <StationEditor id={id} /> : <StationList />;
}

function StationList() {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const { data, error, loading, reload } = useAsync(async () => must(await supabase.from("clinical_stations").select("*").order("created_at", { ascending: false })) as Station[], []);
  return (
    <div>
      <PageHeader title="Viva & CAOSCE stations" subtitle="Practice stations with marking guides. Clearly practice only — not official assessments."
        actions={<Button icon="plus" onClick={() => setCreating(true)}>New station</Button>} />
      {loading && <Loading />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && !data.length && <EmptyState icon="award" title="No stations yet" />}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {data?.map((s) => (
          <Link key={s.id} to={`/admin/stations/${s.id}`}>
            <Card className="hover:border-brand-400">
              <div className="flex flex-wrap items-center gap-2"><Badge tone="brand">{s.kind}</Badge><Badge>{s.bank.replace("_", " ")}</Badge><StatusBadge status={s.status} />{s.is_demo && <DemoBadge />}</div>
              <div className="mt-2 font-semibold">{s.title}</div>
              <div className="ink-2 text-xs">{s.duration_minutes} minutes</div>
            </Card>
          </Link>
        ))}
      </div>
      {creating && <FormModal title="New station" fields={FIELDS} initial={{ kind: "viva", bank: "practice", duration_minutes: 10, status: "draft" }} onClose={() => setCreating(false)}
        onSubmit={async (v) => {
          const row = must(await supabase.from("clinical_stations").insert({ ...v, duration_minutes: Number(v.duration_minutes || 10) }).select("id").single());
          navigate(`/admin/stations/${row.id}`);
        }} />}
    </div>
  );
}

function StationEditor({ id }: { id: string }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const st = useAsync(async () => must(await supabase.from("clinical_stations").select("*").eq("id", id).single()) as Station, [id]);
  const checklist = useAsync(async () => must(await supabase.from("station_checklist_items").select("*").eq("station_id", id).order("position")) as Array<{ id: string; step: string; points: number; is_critical: boolean }>, [id]);
  const viva = useAsync(async () => must(await supabase.from("station_viva_questions").select("*").eq("station_id", id).order("position")) as Array<{ id: string; prompt: string; expected_points: string | null; marks: number }>, [id]);
  const papers = useAsync(async () => {
    const all = must(await supabase.from("exam_papers").select("id, title, paper_number, kind, exam_configs(title, section)").neq("kind", "objective")) as unknown as Array<{ id: string; title: string; paper_number: number; exam_configs: { title: string; section: string } }>;
    const linked = must(await supabase.from("exam_paper_stations").select("paper_id").eq("station_id", id)) as Array<{ paper_id: string }>;
    return { all, linked: new Set(linked.map((l) => l.paper_id)) };
  }, [id]);
  const [step, setStep] = useState({ step: "", points: 1, is_critical: false });
  const [vq, setVq] = useState({ prompt: "", expected_points: "", marks: 2 });

  const run = async (p: PromiseLike<{ error: { message: string } | null }>, after: () => void) => {
    const { error } = await p;
    if (error) toast(friendly(error), "error"); else after();
  };

  if (st.loading) return <Loading />;
  if (st.error || !st.data) return <ErrorBox message={st.error ?? "Not found"} />;
  const s = st.data;

  return (
    <div>
      <Link to="/admin/stations" className="ink-2 mb-3 inline-flex items-center gap-1 text-sm hover:underline"><Icon name="chevronLeft" size={16} />Stations</Link>
      <PageHeader title={s.title} subtitle={<span className="inline-flex gap-2"><Badge tone="brand">{s.kind}</Badge><Badge>{s.bank}</Badge><StatusBadge status={s.status} /></span>}
        actions={<Button variant="secondary" icon="edit" onClick={() => setEditing(true)}>Edit details</Button>} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Procedure checklist (CAOSCE)</h2>
          <ul className="mb-3 space-y-2">
            {checklist.data?.map((c, i, arr) => (
              <li key={c.id} className="flex items-center gap-2 text-sm">
                <ReorderButtons table="station_checklist_items" list={arr} index={i} onDone={checklist.reload} />
                <span className="flex-1">{c.step}</span>{c.is_critical && <Badge tone="danger">critical</Badge>}<span className="ink-2 text-xs">{c.points} pt</span>
                <button className="text-xs text-red-600" onClick={() => run(supabase.from("station_checklist_items").delete().eq("id", c.id), checklist.reload)}>Remove</button>
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-[1fr_70px] gap-2">
            <Input placeholder="Step" value={step.step} onChange={(e) => setStep({ ...step, step: e.target.value })} aria-label="Checklist step" />
            <Input type="number" min={0} step={0.5} value={step.points} onChange={(e) => setStep({ ...step, points: Number(e.target.value) })} aria-label="Points" />
          </div>
          <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={step.is_critical} onChange={(e) => setStep({ ...step, is_critical: e.target.checked })} />Critical (safety) step</label>
          <Button size="sm" className="mt-2" disabled={!step.step.trim()} onClick={() => run(supabase.from("station_checklist_items").insert({ station_id: id, ...step, position: (checklist.data?.length ?? 0) + 1 }), () => { setStep({ step: "", points: 1, is_critical: false }); checklist.reload(); })}>Add step</Button>
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">Viva questions & marking guide</h2>
          <ul className="mb-3 space-y-3">
            {viva.data?.map((v, i, arr) => (
              <li key={v.id} className="rounded-xl border line p-2 text-sm">
                <div className="flex items-start gap-2"><ReorderButtons table="station_viva_questions" list={arr} index={i} onDone={viva.reload} />
                  <span className="flex-1 font-medium">{v.prompt}</span><span className="ink-2 text-xs">{v.marks} marks</span>
                  <button className="text-xs text-red-600" onClick={() => run(supabase.from("station_viva_questions").delete().eq("id", v.id), viva.reload)}>Remove</button></div>
                <p className="ink-2 mt-1 text-xs"><b>Expected:</b> {v.expected_points}</p>
              </li>
            ))}
          </ul>
          <Input placeholder="Examiner question" value={vq.prompt} onChange={(e) => setVq({ ...vq, prompt: e.target.value })} aria-label="Viva question" />
          <Textarea className="mt-2" rows={3} placeholder="Expected points (marking guide)" value={vq.expected_points} onChange={(e) => setVq({ ...vq, expected_points: e.target.value })} aria-label="Expected points" />
          <div className="mt-2 flex items-center gap-2 text-sm">Marks <Input type="number" min={0} step={0.5} className="w-20" value={vq.marks} onChange={(e) => setVq({ ...vq, marks: Number(e.target.value) })} />
            <Button size="sm" disabled={!vq.prompt.trim()} onClick={() => run(supabase.from("station_viva_questions").insert({ station_id: id, ...vq, position: (viva.data?.length ?? 0) + 1 }), () => { setVq({ prompt: "", expected_points: "", marks: 2 }); viva.reload(); })}>Add question</Button></div>
        </Card>

        <Card className="lg:col-span-2">
          <h2 className="mb-3 font-semibold">Use in Paper 4</h2>
          {!papers.data?.all.length ? <p className="ink-2 text-sm">Create a viva or CAOSCE paper under Exams first.</p> : (
            <ul className="space-y-2">
              {papers.data.all.map((p) => (
                <li key={p.id}>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={papers.data!.linked.has(p.id)} onChange={(e) => run(
                      e.target.checked ? supabase.from("exam_paper_stations").insert({ paper_id: p.id, station_id: id, position: 99 })
                        : supabase.from("exam_paper_stations").delete().eq("paper_id", p.id).eq("station_id", id), papers.reload)} />
                    Section {p.exam_configs.section} · {p.exam_configs.title} · Paper {p.paper_number} ({p.title})
                  </label>
                </li>
              ))}
            </ul>
          )}
          {s.bank === "practice" && <p className="ink-2 mt-2 text-xs">Note: practice-bank stations are free for everyone, even when linked to a paid paper.</p>}
        </Card>
      </div>
      {editing && <FormModal title="Edit station" fields={FIELDS} initial={s} onClose={() => setEditing(false)}
        onSubmit={async (v) => {
          const { id: _ignore, ...rest } = v as Record<string, unknown>;
          void _ignore;
          must(await supabase.from("clinical_stations").update({
            title: rest.title, kind: rest.kind, bank: rest.bank, scenario: rest.scenario, candidate_instructions: rest.candidate_instructions || null,
            examiner_notes: rest.examiner_notes || null, duration_minutes: Number(rest.duration_minutes || 10), source_reference: rest.source_reference || null,
            status: rest.status, is_demo: Boolean(rest.is_demo),
          }).eq("id", id));
          st.reload();
        }} />}
    </div>
  );
}
