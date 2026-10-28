import { useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { Icon } from "../../components/Icon";
import { QuestionCard } from "../../components/QuestionCard";
import { Badge, Button, Card, cx, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, StatusBadge, Textarea, Toggle, useToast } from "../../components/ui";
import { rpc } from "../../lib/api";
import { friendly } from "../../lib/errors";
import { dateTime } from "../../lib/format";
import { Link, useNavigate, useParams } from "../../lib/router";
import { supabase } from "../../lib/supabase";
import type { Difficulty, PublicationStatus, QuestionBank, QuestionItem } from "../../lib/types";
import { useAsync } from "../../lib/useAsync";
import { must } from "./adminKit";

interface Opt { label: string; body: string; rationale: string; is_correct: boolean }
interface Form {
  bank: QuestionBank; course_id: string; topic_id: string; stem: string; clinical_scenario: string; image_path: string;
  difficulty: Difficulty; source_reference: string; tags: string; programmes: string[]; options: Opt[]; is_demo: boolean;
}
const LABELS = ["A", "B", "C", "D", "E"];
const blank = (): Form => ({
  bank: "practice", course_id: "", topic_id: "", stem: "", clinical_scenario: "", image_path: "", difficulty: "medium",
  source_reference: "", tags: "", programmes: ["RN", "RM"], is_demo: false,
  options: LABELS.slice(0, 4).map((l, i) => ({ label: l, body: "", rationale: "", is_correct: i === 0 })),
});

export default function AdminQuestionEditor() {
  const { id } = useParams<{ id?: string }>();
  const isNew = !id;
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState<Form>(blank);
  const [status, setStatus] = useState<PublicationStatus>("draft");
  const [changeNote, setChangeNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [dupes, setDupes] = useState<Array<{ id: string; stem: string; similarity: number; bank: string }>>([]);
  const [preview, setPreview] = useState(false);
  const [snapshot, setSnapshot] = useState<Record<string, unknown> | null>(null);

  const refs = useAsync(async () => ({
    courses: must(await supabase.from("courses").select("id, code, title").order("position")) as Array<{ id: string; code: string; title: string }>,
    topics: must(await supabase.from("topics").select("id, title, modules!inner(course_id)").order("position")) as unknown as Array<{ id: string; title: string; modules: { course_id: string } }>,
  }), []);

  const existing = useAsync(async () => {
    if (!id) return null;
    const q = must(await supabase.from("questions").select("*, question_options(*), question_programmes(programmes(code))").eq("id", id).single()) as Record<string, unknown> & {
      question_options: Array<Opt & { id: string }>; question_programmes: Array<{ programmes: { code: string } | null }>; status: PublicationStatus; version: number;
    };
    const versions = must(await supabase.from("question_versions").select("id, version, change_note, created_at, snapshot").eq("question_id", id).order("version", { ascending: false })) as Array<{ id: string; version: number; change_note: string | null; created_at: string; snapshot: Record<string, unknown> }>;
    return { q, versions };
  }, [id]);

  useEffect(() => {
    const q = existing.data?.q;
    if (!q) return;
    setForm({
      bank: q.bank as QuestionBank, course_id: (q.course_id as string) ?? "", topic_id: (q.topic_id as string) ?? "", stem: q.stem as string,
      clinical_scenario: (q.clinical_scenario as string) ?? "", image_path: (q.image_path as string) ?? "", difficulty: q.difficulty as Difficulty,
      source_reference: (q.source_reference as string) ?? "", tags: ((q.tags as string[]) ?? []).join(", "), is_demo: Boolean(q.is_demo),
      programmes: q.question_programmes.map((p) => p.programmes?.code ?? "").filter(Boolean),
      options: [...q.question_options].sort((a, b) => a.label.localeCompare(b.label)).map((o) => ({ label: o.label, body: o.body, rationale: o.rationale ?? "", is_correct: o.is_correct })),
    });
    setStatus(q.status);
  }, [existing.data]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setOpt = (i: number, patch: Partial<Opt>) => setForm((f) => ({ ...f, options: f.options.map((o, j) => (j === i ? { ...o, ...patch } : patch.is_correct ? { ...o, is_correct: false } : o)) }));

  const checkDupes = async () => {
    if (form.stem.trim().length < 10) return;
    try { setDupes(await rpc("admin_similar_questions", { p_stem: form.stem, p_bank: form.bank, p_exclude: id ?? null })); } catch { /* ignore */ }
  };

  const problems = [
    form.stem.trim().length < 5 && "Write the question stem",
    form.options.filter((o) => o.body.trim()).length < 2 && "Add at least two options",
    form.options.filter((o) => o.is_correct && o.body.trim()).length !== 1 && "Mark exactly one correct option",
    form.options.some((o) => o.body.trim() && !o.rationale.trim()) && "Every option needs a rationale before publishing",
    !form.programmes.length && "Choose RN, RM or both",
    !form.topic_id && !form.course_id && "Choose a course or topic",
  ].filter(Boolean) as string[];

  const save = async (nextStatus: PublicationStatus) => {
    setBusy(true);
    try {
      const qid = await rpc<string>("admin_save_question", {
        p: {
          id: id ?? null, bank: form.bank, course_id: form.course_id || null, topic_id: form.topic_id || null, stem: form.stem,
          clinical_scenario: form.clinical_scenario, image_path: form.image_path || null, difficulty: form.difficulty,
          source_reference: form.source_reference, tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
          programmes: form.programmes, is_demo: form.is_demo, status: nextStatus, change_note: changeNote || null,
          options: form.options.filter((o) => o.body.trim()).map((o) => ({ label: o.label, body: o.body, rationale: o.rationale, is_correct: o.is_correct })),
        },
      });
      toast("Question saved");
      setChangeNote("");
      if (isNew) navigate(`/admin/questions/${qid}`, { replace: true }); else existing.reload();
    } catch (e) { toast(friendly(e), "error"); }
    setBusy(false);
  };

  const uploadImage = async (file: File) => {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) return toast("Use a PNG, JPEG or WebP under 5 MB", "error");
    const path = `${Date.now()}-${file.name.replace(/[^\w.-]+/g, "_").slice(-60)}`;
    const { error } = await supabase.storage.from("question-images").upload(path, file, { contentType: file.type });
    if (error) return toast(friendly(error), "error");
    set("image_path", path);
  };

  if (refs.loading || existing.loading) return <Loading />;
  if (existing.error) return <ErrorBox message={existing.error} />;
  const topics = (refs.data?.topics ?? []).filter((t) => !form.course_id || t.modules.course_id === form.course_id);

  const previewItem: QuestionItem = {
    position: 1, question_id: id ?? "new", stem: form.stem || "(stem)", scenario: form.clinical_scenario || null, image_path: form.image_path || null,
    difficulty: form.difficulty, topic_id: form.topic_id || null, topic: topics.find((t) => t.id === form.topic_id)?.title ?? null, is_demo: form.is_demo,
    options: form.options.filter((o) => o.body.trim()).map((o) => ({ id: o.label, label: o.label, body: o.body })), selected_option_id: null,
  };

  return (
    <div>
      <Link to="/admin/questions" className="ink-2 mb-3 inline-flex items-center gap-1 text-sm hover:underline"><Icon name="chevronLeft" size={16} />Questions</Link>
      <PageHeader title={isNew ? "New question" : "Edit question"}
        subtitle={!isNew && existing.data ? <span className="inline-flex items-center gap-2"><StatusBadge status={status} /> version {existing.data.q.version as number}</span> : undefined}
        actions={<Button variant="secondary" icon="eye" onClick={() => setPreview(true)}>Preview</Button>} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_320px]">
        <Card className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Field label="Bank">{(fid) => (
              <Select id={fid} value={form.bank} onChange={(e) => set("bank", e.target.value as QuestionBank)}>
                <option value="practice">Practice (Section B)</option><option value="section_c">Section C pool</option><option value="section_d">Section D pool</option>
              </Select>
            )}</Field>
            <Field label="Course">{(fid) => (
              <Select id={fid} value={form.course_id} onChange={(e) => { set("course_id", e.target.value); set("topic_id", ""); }}>
                <option value="">—</option>{refs.data?.courses.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
              </Select>
            )}</Field>
            <Field label="Topic">{(fid) => (
              <Select id={fid} value={form.topic_id} onChange={(e) => set("topic_id", e.target.value)}>
                <option value="">—</option>{topics.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </Select>
            )}</Field>
            <Field label="Difficulty">{(fid) => (
              <Select id={fid} value={form.difficulty} onChange={(e) => set("difficulty", e.target.value as Difficulty)}>
                <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
              </Select>
            )}</Field>
          </div>

          <div className="flex flex-wrap gap-4">
            {["RN", "RM"].map((p) => (
              <label key={p} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.programmes.includes(p)}
                onChange={(e) => set("programmes", e.target.checked ? [...form.programmes, p] : form.programmes.filter((x) => x !== p))} />{p}</label>
            ))}
            <Toggle checked={form.is_demo} onChange={(v) => set("is_demo", v)} label="Demo content" />
          </div>

          <Field label="Clinical scenario (optional)">{(fid) => <Textarea id={fid} rows={3} value={form.clinical_scenario} onChange={(e) => set("clinical_scenario", e.target.value)} />}</Field>
          <Field label="Question stem">{(fid) => <Textarea id={fid} rows={3} value={form.stem} onChange={(e) => set("stem", e.target.value)} onBlur={checkDupes} />}</Field>
          {dupes.length > 0 && (
            <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
              <b>Possible duplicates:</b>
              <ul className="mt-1 list-disc pl-5">{dupes.map((d) => <li key={d.id}><Link to={`/admin/questions/${d.id}`} className="underline">{d.stem.slice(0, 110)}</Link> ({Math.round(d.similarity * 100)}% similar)</li>)}</ul>
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-center justify-between"><span className="text-sm font-semibold">Options & rationales</span>
              {form.options.length < 5 && <Button size="sm" variant="ghost" icon="plus" onClick={() => set("options", [...form.options, { label: LABELS[form.options.length], body: "", rationale: "", is_correct: false }])}>Option {LABELS[form.options.length]}</Button>}
            </div>
            {form.options.map((o, i) => (
              <div key={o.label} className={cx("rounded-xl border-2 p-3", o.is_correct ? "border-emerald-400" : "line")}>
                <div className="mb-2 flex items-center gap-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-700 text-sm font-bold text-white">{o.label}</span>
                  <label className="flex items-center gap-1 text-sm"><input type="radio" name="correct" checked={o.is_correct} onChange={() => setOpt(i, { is_correct: true })} />Correct answer</label>
                  {i >= 2 && i === form.options.length - 1 && <button className="ml-auto text-xs text-red-600" onClick={() => set("options", form.options.slice(0, -1))}>Remove</button>}
                </div>
                <Input placeholder={`Option ${o.label}`} value={o.body} onChange={(e) => setOpt(i, { body: e.target.value })} aria-label={`Option ${o.label}`} />
                <Textarea rows={2} className="mt-2" placeholder={o.is_correct ? "Why this is the correct answer…" : "Why this option is wrong…"} value={o.rationale}
                  onChange={(e) => setOpt(i, { rationale: e.target.value })} aria-label={`Rationale ${o.label}`} />
              </div>
            ))}
            <p className="ink-2 text-xs">Tip: if options are shuffled in exams, don't refer to letters ("unlike option B") inside rationales.</p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Source / reference">{(fid) => <Input id={fid} value={form.source_reference} onChange={(e) => set("source_reference", e.target.value)} placeholder="Textbook, guideline, page" />}</Field>
            <Field label="Tags (comma-separated)">{(fid) => <Input id={fid} value={form.tags} onChange={(e) => set("tags", e.target.value)} />}</Field>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="cursor-pointer text-sm font-semibold text-brand-700 underline dark:text-brand-300">{form.image_path ? "Replace image" : "Attach image"}
              <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && uploadImage(e.target.files[0])} /></label>
            {form.image_path && <><span className="ink-2 text-xs">{form.image_path}</span><button className="text-xs text-red-600" onClick={() => set("image_path", "")}>Remove</button></>}
          </div>
        </Card>

        <aside className="space-y-4">
          <Card className="space-y-3">
            <h3 className="text-sm font-semibold">Save</h3>
            {problems.length > 0 && <ul className="list-disc pl-5 text-xs text-amber-700 dark:text-amber-300">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
            <Input placeholder="Change note (optional)" value={changeNote} onChange={(e) => setChangeNote(e.target.value)} aria-label="Change note" />
            <Button className="w-full" variant="secondary" loading={busy} onClick={() => save(status === "published" ? "published" : "draft")}>
              {status === "published" ? "Save (stays published)" : "Save draft"}
            </Button>
            {status !== "published" && <Button className="w-full" variant="secondary" disabled={busy} onClick={() => save("in_review")}>Save & send to review</Button>}
            {can("questions.review") && status !== "published" && <Button className="w-full" disabled={busy || problems.length > 0} onClick={() => save("published")}>Approve & publish</Button>}
            {status === "published" && <Button className="w-full" variant="ghost" disabled={busy} onClick={() => save("unpublished")}>Unpublish</Button>}
          </Card>
          {existing.data && (
            <Card>
              <h3 className="mb-2 text-sm font-semibold">Change history</h3>
              <ul className="space-y-1 text-sm">
                {existing.data.versions.map((v) => (
                  <li key={v.id} className="flex items-center gap-2">
                    <Badge>v{v.version}</Badge><span className="ink-2 flex-1 truncate text-xs">{v.change_note ?? "—"} · {dateTime(v.created_at)}</span>
                    <button className="text-xs underline" onClick={() => setSnapshot(v.snapshot)}>View</button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </aside>
      </div>

      <Modal open={preview} onClose={() => setPreview(false)} title="Student preview (after answering)" wide>
        <QuestionCard item={previewItem} number={1} total={1} selected={null}
          feedback={{ correct_option_id: form.options.find((o) => o.is_correct)?.label ?? "", source_reference: form.source_reference || null,
            options: form.options.filter((o) => o.body.trim()).map((o) => ({ id: o.label, label: o.label, body: o.body, is_correct: o.is_correct, rationale: o.rationale })) }} />
      </Modal>
      <Modal open={!!snapshot} onClose={() => setSnapshot(null)} title="Version snapshot" wide>
        <pre className="surface-2 max-h-[60vh] overflow-auto rounded-xl p-3 text-xs">{JSON.stringify(snapshot, null, 2)}</pre>
      </Modal>
    </div>
  );
}
