import { useState } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { Badge, Button, Card, DemoBadge, EmptyState, ErrorBox, Loading, PageHeader, StatusBadge, Tabs, useToast } from "../../components/ui";
import { api } from "../../lib/api";
import { friendly } from "../../lib/errors";
import { Link, useNavigate } from "../../lib/router";
import { supabase } from "../../lib/supabase";
import type { PublicationStatus } from "../../lib/types";
import { useAsync } from "../../lib/useAsync";
import { type FieldDef, FormModal, must, ReorderButtons } from "./adminKit";

interface Config { id: string; section: "C" | "D"; title: string; description: string | null; instructions: string | null; programme_id: string | null; status: PublicationStatus; max_attempts: number | null; position: number; is_demo: boolean }
interface Paper { id: string; config_id: string; paper_number: number; title: string; kind: string; question_count: number; duration_minutes: number; pool_id: string | null; pass_mark_percent: number | null; review_policy: string; shuffle_options: boolean; instructions: string | null }
interface Pool { id: string; bank: string; name: string; description: string | null; question_pool_items: Array<{ count: number }> }
type ModalState = { title: string; fields: FieldDef[]; initial: object; submit: (v: Record<string, unknown>) => Promise<void> } | null;

export default function AdminExams() {
  const [section, setSection] = useState<"C" | "D">("C");
  return (
    <div>
      <PageHeader title="Exam configuration" subtitle="Sections C and D are configured independently with separate question pools. Verify paper structure, timing and pass marks against official requirements before publishing."
        actions={<Link to="/admin/payments?tab=products"><Button variant="secondary">Prices & access duration</Button></Link>} />
      <Tabs value={section} onChange={setSection} tabs={[{ id: "C", label: "Section C — Mock" }, { id: "D", label: "Section D — Final" }]} />
      <SectionEditor key={section} section={section} />
    </div>
  );
}

function SectionEditor({ section }: { section: "C" | "D" }) {
  const { programmes } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const bank = section === "C" ? "section_c" : "section_d";
  const [modal, setModal] = useState<ModalState>(null);
  const data = useAsync(async () => {
    const configs = must(await supabase.from("exam_configs").select("*").eq("section", section).order("position")) as Config[];
    const ids = configs.map((c) => c.id);
    const papers = ids.length ? must(await supabase.from("exam_papers").select("*").in("config_id", ids).order("paper_number")) as Paper[] : [];
    const pools = must(await supabase.from("question_pools").select("*, question_pool_items(count)").eq("bank", bank).order("name")) as unknown as Pool[];
    return { configs, papers, pools };
  }, [section]);

  const configFields: FieldDef[] = [
    { key: "title", label: "Title", required: true },
    { key: "description", label: "Description", type: "textarea" },
    { key: "instructions", label: "Candidate instructions (Markdown)", type: "textarea" },
    { key: "programme_id", label: "Programme", type: "select", options: [["", "Both RN & RM"], ...programmes.map((p) => [p.id, p.code] as [string, string])] },
    { key: "max_attempts", label: "Max attempts per paper (blank = unlimited)", type: "number" },
    { key: "status", label: "Status", type: "select", options: [["draft", "Draft"], ["published", "Published"], ["unpublished", "Unpublished"], ["archived", "Archived"]] },
    { key: "is_demo", label: "Demonstration content", type: "checkbox" },
  ];
  const saveConfig = (id?: string) => async (v: Record<string, unknown>) => {
    const payload = { section, title: v.title, description: v.description || null, instructions: v.instructions || null, programme_id: v.programme_id || null,
      max_attempts: v.max_attempts === "" || v.max_attempts == null ? null : Number(v.max_attempts), status: v.status || "draft", is_demo: Boolean(v.is_demo) };
    if (id) must(await supabase.from("exam_configs").update(payload).eq("id", id));
    else must(await supabase.from("exam_configs").insert({ ...payload, position: (data.data?.configs.length ?? 0) + 1 }));
    data.reload();
  };

  const paperFields = (pools: Pool[]): FieldDef[] => [
    { key: "paper_number", label: "Paper number", type: "number", required: true },
    { key: "title", label: "Title", required: true },
    { key: "kind", label: "Type", type: "select", options: [["objective", "Objective (MCQ)"], ["viva", "Viva practice"], ["caosce", "CAOSCE-style practice"]] },
    { key: "pool_id", label: "Question pool (objective papers)", type: "select", options: [["", "—"], ...pools.map((p) => [p.id, `${p.name} (${p.question_pool_items[0]?.count ?? 0})`] as [string, string])] },
    { key: "question_count", label: "Questions drawn per attempt", type: "number" },
    { key: "duration_minutes", label: "Time limit (minutes)", type: "number", required: true },
    { key: "pass_mark_percent", label: "Practice pass mark % (blank = none)", type: "number" },
    { key: "review_policy", label: "Answer review", type: "select", options: [["after_submit", "Allow review after submission"], ["none", "No review"]] },
    { key: "shuffle_options", label: "Shuffle answer options", type: "checkbox" },
    { key: "instructions", label: "Paper instructions", type: "textarea" },
  ];
  const savePaper = (configId: string, id?: string) => async (v: Record<string, unknown>) => {
    const payload = { config_id: configId, paper_number: Number(v.paper_number), title: v.title, kind: v.kind || "objective", pool_id: v.pool_id || null,
      question_count: Number(v.question_count || 0), duration_minutes: Number(v.duration_minutes), pass_mark_percent: v.pass_mark_percent === "" || v.pass_mark_percent == null ? null : Number(v.pass_mark_percent),
      review_policy: v.review_policy || "after_submit", shuffle_options: Boolean(v.shuffle_options), instructions: v.instructions || null };
    if (id) must(await supabase.from("exam_papers").update(payload).eq("id", id));
    else must(await supabase.from("exam_papers").insert(payload));
    data.reload();
  };

  const preview = async (paperId: string) => {
    try { const r = await api.examStart(paperId); navigate(`/exam/${r.attempt_id}`); } catch (e) { toast(friendly(e), "error"); }
  };

  if (data.loading) return <Loading />;
  if (data.error || !data.data) return <ErrorBox message={data.error ?? "Could not load"} onRetry={data.reload} />;
  const { configs, papers, pools } = data.data;

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <div className="flex justify-end"><Button icon="plus" onClick={() => setModal({ title: `New Section ${section} exam`, fields: configFields, initial: { status: "draft" }, submit: saveConfig() })}>Exam configuration</Button></div>
        {!configs.length && <EmptyState icon="clipboard" title="No exams yet" />}
        {configs.map((c, ci) => (
          <Card key={c.id}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <ReorderButtons table="exam_configs" list={configs} index={ci} onDone={data.reload} />
              <h2 className="font-semibold">{c.title}</h2><StatusBadge status={c.status} />{c.is_demo && <DemoBadge />}
              {c.max_attempts && <Badge>{c.max_attempts} attempts</Badge>}
              <div className="flex-1" />
              <Button size="sm" variant="secondary" onClick={() => setModal({ title: "Edit exam", fields: configFields, initial: { ...c, programme_id: c.programme_id ?? "" }, submit: saveConfig(c.id) })}>Edit</Button>
              <Button size="sm" icon="plus" onClick={() => setModal({ title: "New paper", fields: paperFields(pools), initial: { paper_number: papers.filter((p) => p.config_id === c.id).length + 1, kind: "objective", duration_minutes: 60, question_count: 50, review_policy: "after_submit", shuffle_options: true }, submit: savePaper(c.id) })}>Paper</Button>
            </div>
            <table className="w-full text-sm">
              <thead className="ink-2 text-left text-xs uppercase"><tr><th className="py-1">#</th><th>Paper</th><th>Type</th><th>Pool</th><th>Qs</th><th>Time</th><th>Pass</th><th /></tr></thead>
              <tbody>
                {papers.filter((p) => p.config_id === c.id).map((p) => {
                  const pool = pools.find((x) => x.id === p.pool_id);
                  const poolSize = pool?.question_pool_items[0]?.count ?? 0;
                  return (
                    <tr key={p.id} className="border-t line">
                      <td className="py-2">{p.paper_number}</td><td>{p.title}</td><td>{p.kind}</td>
                      <td>{p.kind === "objective" ? (pool ? <>{pool.name} {poolSize < p.question_count && <Badge tone="warning">only {poolSize}</Badge>}</> : <Badge tone="danger">none</Badge>) : "—"}</td>
                      <td>{p.kind === "objective" ? p.question_count : "—"}</td><td>{p.duration_minutes}m</td><td>{p.pass_mark_percent ?? "—"}</td>
                      <td className="space-x-2 text-right text-xs">
                        <button className="underline" onClick={() => setModal({ title: "Edit paper", fields: paperFields(pools), initial: { ...p, pool_id: p.pool_id ?? "", pass_mark_percent: p.pass_mark_percent ?? "" }, submit: savePaper(c.id, p.id) })}>Edit</button>
                        {p.kind === "objective" ? <button className="underline" onClick={() => preview(p.id)}>Preview</button> : <Link className="underline" to="/admin/stations">Stations</Link>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {papers.filter((p) => p.config_id === c.id).reduce((s, p) => s + (p.kind === "objective" ? p.question_count : 0), 0) > 0 && (
              <p className="ink-2 mt-2 text-xs">Objective questions across papers: {papers.filter((p) => p.config_id === c.id && p.kind === "objective").reduce((s, p) => s + p.question_count, 0)}</p>
            )}
          </Card>
        ))}
      </div>

      <Card className="h-fit">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Section {section} pools</h2>
          <Button size="sm" icon="plus" onClick={() => setModal({ title: "New pool", fields: [{ key: "name", label: "Name", required: true }, { key: "description", label: "Description", type: "textarea" }], initial: {},
            submit: async (v) => { must(await supabase.from("question_pools").insert({ bank, name: v.name, description: v.description || null })); data.reload(); } })}>Pool</Button>
        </div>
        <ul className="space-y-2">
          {pools.map((p) => (
            <li key={p.id}><Link to={`/admin/pools/${p.id}`} className="flex justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--surface-2)]"><span>{p.name}</span><span className="ink-2">{p.question_pool_items[0]?.count ?? 0} Qs</span></Link></li>
          ))}
          {!pools.length && <li className="ink-2 text-sm">No pools yet. Questions must be in the {bank.replace("_", " ")} bank to be added.</li>}
        </ul>
      </Card>
      {modal && <FormModal title={modal.title} fields={modal.fields} initial={modal.initial} onSubmit={modal.submit} onClose={() => setModal(null)} />}
    </div>
  );
}
