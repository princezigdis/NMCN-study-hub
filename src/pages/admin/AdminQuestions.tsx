import { useState } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { Badge, Button, Card, DemoBadge, EmptyState, ErrorBox, Input, Loading, PageHeader, Select, StatusBadge, useToast } from "../../components/ui";
import { rpc } from "../../lib/api";
import { downloadText, QUESTION_COLUMNS, toCsv } from "../../lib/csv";
import { friendly } from "../../lib/errors";
import { dateShort } from "../../lib/format";
import { Link, useSearchParams } from "../../lib/router";
import { supabase } from "../../lib/supabase";
import type { Difficulty, PublicationStatus, QuestionBank } from "../../lib/types";
import { useAsync } from "../../lib/useAsync";
import { must } from "./adminKit";

const PAGE = 50;
interface Row {
  id: string; bank: QuestionBank; stem: string; difficulty: Difficulty; status: PublicationStatus; version: number;
  is_demo: boolean; updated_at: string; topics: { title: string } | null; question_programmes: Array<{ programmes: { code: string } | null }>;
}

export default function AdminQuestions() {
  const { can } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const f = { bank: params.get("bank") ?? "", status: params.get("status") ?? "", difficulty: params.get("difficulty") ?? "", topic: params.get("topic") ?? "", q: params.get("q") ?? "" };
  const page = Number(params.get("page") ?? "0");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState(f.q);

  const topics = useAsync(async () => must(await supabase.from("topics").select("id, title").order("title")) as Array<{ id: string; title: string }>, []);

  const build = (sel: string) => {
    let query = supabase.from("questions").select(sel, { count: "exact" });
    if (f.bank) query = query.eq("bank", f.bank);
    if (f.status) query = query.eq("status", f.status);
    if (f.difficulty) query = query.eq("difficulty", f.difficulty);
    if (f.topic) query = query.eq("topic_id", f.topic);
    if (f.q) query = query.ilike("stem", `%${f.q.replace(/[%_]/g, "")}%`);
    return query;
  };

  const list = useAsync(async () => {
    const res = await build("id, bank, stem, difficulty, status, version, is_demo, updated_at, topics(title), question_programmes(programmes(code))")
      .order("updated_at", { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
    if (res.error) throw res.error;
    return { rows: res.data as unknown as Row[], count: res.count ?? 0 };
  }, [f.bank, f.status, f.difficulty, f.topic, f.q, page]);

  const bulk = async (status: PublicationStatus) => {
    try {
      const r = await rpc<{ updated: number; failed: Array<{ id: string; problems: string[] }> }>("admin_set_question_status", { p_ids: [...selected], p_status: status });
      toast(`${r.updated} updated${r.failed.length ? `, ${r.failed.length} not ready: ${r.failed[0].problems.join("; ")}` : ""}`, r.failed.length ? "info" : "success");
      setSelected(new Set());
      list.reload();
    } catch (e) { toast(friendly(e), "error"); }
  };

  const exportCsv = async () => {
    const res = await build("bank, stem, clinical_scenario, difficulty, source_reference, tags, courses(code), topics(title), question_programmes(programmes(code)), question_options(label, body, rationale, is_correct)").limit(2000);
    if (res.error) return toast(friendly(res.error), "error");
    type Ex = { bank: string; stem: string; clinical_scenario: string | null; difficulty: string; source_reference: string | null; tags: string[]; courses: { code: string } | null; topics: { title: string } | null; question_programmes: Array<{ programmes: { code: string } | null }>; question_options: Array<{ label: string; body: string; rationale: string | null; is_correct: boolean }> };
    const rows = (res.data as unknown as Ex[]).map((q) => {
      const o: Record<string, unknown> = {
        bank: q.bank, course_code: q.courses?.code ?? "", topic_title: q.topics?.title ?? "", stem: q.stem, scenario: q.clinical_scenario ?? "",
        difficulty: q.difficulty, programmes: q.question_programmes.map((p) => p.programmes?.code).filter(Boolean).join(","),
        correct: q.question_options.find((x) => x.is_correct)?.label ?? "", source: q.source_reference ?? "", tags: q.tags.join(","),
      };
      for (const opt of q.question_options) { o[`option_${opt.label.toLowerCase()}`] = opt.body; o[`rationale_${opt.label.toLowerCase()}`] = opt.rationale ?? ""; }
      return o;
    });
    downloadText(`questions-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(QUESTION_COLUMNS, rows));
  };

  const pages = Math.ceil((list.data?.count ?? 0) / PAGE);
  const set = (k: string, v: string) => setParams({ [k]: v || null, page: null });

  return (
    <div>
      <PageHeader title="Questions" subtitle="Practice bank (Section B), Section C and Section D pools are kept separate."
        actions={<>
          <Button variant="secondary" icon="download" onClick={exportCsv}>Export CSV</Button>
          {can("questions.manage") && <Link to="/admin/import"><Button variant="secondary" icon="upload">Import</Button></Link>}
          {can("questions.manage") && <Link to="/admin/questions/new"><Button icon="plus">New question</Button></Link>}
        </>} />

      <Card className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-6">
        <form className="sm:col-span-2" onSubmit={(e) => { e.preventDefault(); set("q", search.trim()); }}>
          <Input placeholder="Search question text…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
        </form>
        <Select value={f.bank} onChange={(e) => set("bank", e.target.value)} aria-label="Bank"><option value="">All banks</option><option value="practice">Practice (B)</option><option value="section_c">Section C</option><option value="section_d">Section D</option></Select>
        <Select value={f.status} onChange={(e) => set("status", e.target.value)} aria-label="Status"><option value="">Any status</option>{["draft", "in_review", "published", "unpublished", "archived"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</Select>
        <Select value={f.difficulty} onChange={(e) => set("difficulty", e.target.value)} aria-label="Difficulty"><option value="">Any difficulty</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></Select>
        <Select value={f.topic} onChange={(e) => set("topic", e.target.value)} aria-label="Topic"><option value="">All topics</option>{topics.data?.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</Select>
      </Card>

      {selected.size > 0 && (
        <div className="surface sticky top-2 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-xl border line p-2 shadow">
          <span className="px-2 text-sm font-semibold">{selected.size} selected</span>
          {can("questions.manage") && <Button size="sm" variant="secondary" onClick={() => bulk("in_review")}>Send to review</Button>}
          {can("questions.review") && <Button size="sm" onClick={() => bulk("published")}>Publish</Button>}
          {can("questions.manage") && <Button size="sm" variant="secondary" onClick={() => bulk("unpublished")}>Unpublish</Button>}
          {can("questions.manage") && <Button size="sm" variant="ghost" onClick={() => bulk("archived")}>Retire (archive)</Button>}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      {list.loading && <Loading />}
      {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}
      {list.data && !list.data.rows.length && <EmptyState icon="quiz" title="No questions match">Adjust filters or add questions.</EmptyState>}
      {list.data && list.data.rows.length > 0 && (
        <Card className="overflow-x-auto p-0 sm:p-0">
          <table className="w-full text-sm">
            <thead className="ink-2 surface-2 text-left text-xs uppercase">
              <tr>
                <th className="p-3"><input type="checkbox" aria-label="Select all" checked={list.data.rows.every((r) => selected.has(r.id))}
                  onChange={(e) => setSelected(e.target.checked ? new Set(list.data!.rows.map((r) => r.id)) : new Set())} /></th>
                <th>Question</th><th>Bank</th><th>Topic</th><th>Prog.</th><th>Level</th><th>Status</th><th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {list.data.rows.map((r) => (
                <tr key={r.id} className="border-t line align-top">
                  <td className="p-3"><input type="checkbox" aria-label="Select" checked={selected.has(r.id)} onChange={(e) => {
                    const n = new Set(selected); if (e.target.checked) n.add(r.id); else n.delete(r.id); setSelected(n);
                  }} /></td>
                  <td className="max-w-md py-3 pr-3"><Link to={`/admin/questions/${r.id}`} className="line-clamp-2 font-medium hover:underline">{r.stem}</Link>{r.is_demo && <DemoBadge />}</td>
                  <td className="py-3"><Badge tone={r.bank === "practice" ? "neutral" : "brand"}>{r.bank === "practice" ? "B" : r.bank === "section_c" ? "C" : "D"}</Badge></td>
                  <td className="ink-2 py-3">{r.topics?.title ?? "—"}</td>
                  <td className="py-3 text-xs">{r.question_programmes.map((p) => p.programmes?.code).join("+")}</td>
                  <td className="py-3 text-xs">{r.difficulty}</td>
                  <td className="py-3"><StatusBadge status={r.status} /><span className="ink-2 ml-1 text-[10px]">v{r.version}</span></td>
                  <td className="ink-2 py-3 text-xs">{dateShort(r.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {pages > 1 && (
        <div className="mt-3 flex items-center justify-center gap-2 text-sm">
          <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setParams({ page: String(page - 1) })}>Previous</Button>
          <span>Page {page + 1} of {pages} · {list.data?.count} questions</span>
          <Button size="sm" variant="secondary" disabled={page >= pages - 1} onClick={() => setParams({ page: String(page + 1) })}>Next</Button>
        </div>
      )}
    </div>
  );
}
