import { useState } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { Icon } from "../../components/Icon";
import { Badge, Button, Card, cx, DemoBadge, EmptyState, ErrorBox, Loading, PageHeader, StatusBadge, Tabs } from "../../components/ui";
import { dateShort } from "../../lib/format";
import { Link, useNavigate } from "../../lib/router";
import { supabase } from "../../lib/supabase";
import type { Course, Module, Note, Programme, PublicationStatus, Topic } from "../../lib/types";
import { useAsync } from "../../lib/useAsync";
import { ContentStatus, type FieldDef, FormModal, must, ReorderButtons } from "./adminKit";

type CourseRow = Course & { course_programmes: Array<{ programme_id: string }> };
type ModalState = { title: string; fields: FieldDef[]; initial: object; submit: (v: Record<string, unknown>) => Promise<void> } | null;


export default function AdminCurriculum() {
  const [tab, setTab] = useState<"courses" | "review" | "versions">("courses");
  return (
    <div>
      <PageHeader title="Curriculum & notes" subtitle="Programmes, curriculum versions, courses, modules, topics and study notes. Content shared by RN and RM is stored once." />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "courses", label: "Course structure" }, { id: "review", label: "Review queue" }, { id: "versions", label: "Curriculum versions" }]} />
      {tab === "courses" && <CourseTree />}
      {tab === "review" && <ReviewQueue />}
      {tab === "versions" && <CurriculumVersions />}
    </div>
  );
}

function CourseTree() {
  const { programmes } = useAuth();
  const navigate = useNavigate();
  const [modal, setModal] = useState<ModalState>(null);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const courses = useAsync(async () => must(await supabase.from("courses").select("*, course_programmes(programme_id)").order("position")) as CourseRow[], []);
  const tree = useAsync(async () => {
    if (!courseId) return null;
    const modules = must(await supabase.from("modules").select("*").eq("course_id", courseId).order("position")) as Module[];
    const ids = modules.map((m) => m.id);
    const topics = ids.length ? must(await supabase.from("topics").select("*").in("module_id", ids).order("position")) as Topic[] : [];
    const tids = topics.map((t) => t.id);
    const notes = tids.length ? must(await supabase.from("notes").select("*").in("topic_id", tids).order("position")) as Note[] : [];
    return { modules, topics, notes };
  }, [courseId]);

  const programmeFields = (p: Programme[]): FieldDef[] => p.map((x) => ({ key: `prog_${x.code}`, label: `Available to ${x.name} (${x.code})`, type: "checkbox" }));
  const courseFields: FieldDef[] = [
    { key: "code", label: "Course code", required: true, hint: "Short unique code, e.g. NSC 201" },
    { key: "title", label: "Title", required: true },
    { key: "level", label: "Level / year", hint: "e.g. Year 1" },
    { key: "description", label: "Description", type: "textarea" },
    { key: "source", label: "Curriculum source", hint: "Where this course appears in the official curriculum" },
    ...programmeFields(programmes),
    { key: "is_demo", label: "Demonstration content (shows a Demo badge)", type: "checkbox" },
  ];

  const saveCourse = (existing?: CourseRow) => async (v: Record<string, unknown>) => {
    const payload = { code: String(v.code).trim(), title: String(v.title).trim(), level: v.level || null, description: v.description || null, source: v.source || null, is_demo: Boolean(v.is_demo) };
    const row = existing
      ? must(await supabase.from("courses").update(payload).eq("id", existing.id).select("id").single())
      : must(await supabase.from("courses").insert({ ...payload, position: (courses.data?.length ?? 0) + 1 }).select("id").single());
    await supabase.from("course_programmes").delete().eq("course_id", row.id);
    const links = programmes.filter((p) => v[`prog_${p.code}`]).map((p) => ({ course_id: row.id, programme_id: p.id }));
    if (links.length) must(await supabase.from("course_programmes").insert(links));
    courses.reload();
  };

  const visible = (courses.data ?? []).filter((c) => showArchived || c.status !== "archived");
  const course = courses.data?.find((c) => c.id === courseId);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
      <Card className="h-fit">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Courses</h2>
          <Button size="sm" icon="plus" onClick={() => setModal({ title: "New course", fields: courseFields, initial: Object.fromEntries(programmes.map((p) => [`prog_${p.code}`, true])), submit: saveCourse() })}>Course</Button>
        </div>
        <label className="ink-2 mb-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />Show archived</label>
        {courses.loading && <Loading />}
        {courses.error && <ErrorBox message={courses.error} />}
        <ul className="space-y-1">
          {visible.map((c, i) => (
            <li key={c.id} className={cx("flex items-center gap-1 rounded-lg px-2 py-1.5", courseId === c.id ? "bg-brand-50 dark:bg-brand-900/40" : "hover:bg-[var(--surface-2)]")}>
              <ReorderButtons table="courses" list={visible} index={i} onDone={courses.reload} />
              <button className="min-w-0 flex-1 text-left" onClick={() => setCourseId(c.id)}>
                <div className="truncate text-sm font-medium">{c.code} · {c.title}</div>
                <div className="flex items-center gap-1"><StatusBadge status={c.status} />{c.is_demo && <DemoBadge />}
                  <span className="ink-2 text-[11px]">{c.course_programmes.map((cp) => programmes.find((p) => p.id === cp.programme_id)?.code).join("+")}</span></div>
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <div>
        {!course ? <EmptyState icon="book" title="Select a course">Choose a course to manage its modules, topics and notes.</EmptyState> : (
          <Card>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">{course.code} · {course.title}</h2>
              <ContentStatus table="courses" id={course.id} status={course.status} onChange={courses.reload} />
              <div className="flex-1" />
              <Button size="sm" variant="secondary" icon="edit" onClick={() => setModal({
                title: "Edit course", fields: courseFields, submit: saveCourse(course),
                initial: { ...course, ...Object.fromEntries(programmes.map((p) => [`prog_${p.code}`, course.course_programmes.some((cp) => cp.programme_id === p.id)])) },
              })}>Edit</Button>
              <Button size="sm" icon="plus" onClick={() => setModal({
                title: "New module", fields: [{ key: "title", label: "Module title", required: true }, { key: "description", label: "Description", type: "textarea" }],
                initial: {}, submit: async (v) => { must(await supabase.from("modules").insert({ course_id: course.id, title: v.title, description: v.description || null, position: (tree.data?.modules.length ?? 0) + 1 })); tree.reload(); },
              })}>Module</Button>
            </div>
            {tree.loading && <Loading />}
            {tree.data && !tree.data.modules.length && <p className="ink-2 text-sm">No modules yet.</p>}
            <div className="space-y-4">
              {tree.data?.modules.map((m, mi, mods) => {
                const topics = tree.data!.topics.filter((t) => t.module_id === m.id && !t.parent_topic_id);
                return (
                  <div key={m.id} className="rounded-xl border line">
                    <div className="surface-2 flex flex-wrap items-center gap-2 rounded-t-xl px-3 py-2">
                      <ReorderButtons table="modules" list={mods} index={mi} onDone={tree.reload} />
                      <span className="font-semibold">{m.title}</span>
                      <ContentStatus table="modules" id={m.id} status={m.status} onChange={tree.reload} />
                      <div className="flex-1" />
                      <button className="ink-2 text-xs underline" onClick={() => setModal({ title: "Edit module", fields: [{ key: "title", label: "Title", required: true }, { key: "description", label: "Description", type: "textarea" }], initial: m, submit: async (v) => { must(await supabase.from("modules").update({ title: v.title, description: v.description || null }).eq("id", m.id)); tree.reload(); } })}>Edit</button>
                      <Button size="sm" variant="secondary" icon="plus" onClick={() => setModal(topicModal(m.id, null, topics.length, tree.reload))}>Topic</Button>
                    </div>
                    <ul className="divide-y divide-[var(--line)]">
                      {topics.map((t, ti) => (
                        <TopicRow key={t.id} topic={t} index={ti} siblings={topics} data={tree.data!} reload={tree.reload} setModal={setModal}
                          openNote={(id) => navigate(`/admin/notes/${id}`)} />
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>
      {modal && <FormModal title={modal.title} fields={modal.fields} initial={modal.initial} onSubmit={modal.submit} onClose={() => setModal(null)} />}
    </div>
  );
}

function topicModal(moduleId: string, parentId: string | null, count: number, reload: () => void): NonNullable<ModalState> {
  return {
    title: parentId ? "New subtopic" : "New topic",
    fields: [{ key: "title", label: "Title", required: true }, { key: "summary", label: "Summary", type: "textarea" }],
    initial: {},
    submit: async (v) => { must(await supabase.from("topics").insert({ module_id: moduleId, parent_topic_id: parentId, title: v.title, summary: v.summary || null, position: count + 1 })); reload(); },
  };
}

function TopicRow({ topic: t, index, siblings, data, reload, setModal, openNote, depth = 0 }: {
  topic: Topic; index: number; siblings: Topic[]; data: { topics: Topic[]; notes: Note[] }; reload: () => void;
  setModal: (m: ModalState) => void; openNote: (id: string) => void; depth?: number;
}) {
  const children = data.topics.filter((c) => c.parent_topic_id === t.id);
  const notes = data.notes.filter((n) => n.topic_id === t.id);
  const createNote = async (v: Record<string, unknown>) => {
    const note = must(await supabase.from("notes").insert({ topic_id: t.id, title: v.title, kind: v.kind || "note", position: notes.length + 1, is_demo: Boolean(v.is_demo) }).select("id").single());
    must(await supabase.from("note_versions").insert({ note_id: note.id, version: 0, body_md: `# ${v.title}\n\nStart writing…`, status: "draft" }));
    openNote(note.id);
  };
  return (
    <li className={cx("px-3 py-2", depth && "ml-6 border-l-2 line")}>
      <div className="flex flex-wrap items-center gap-2">
        <ReorderButtons table="topics" list={siblings} index={index} onDone={reload} />
        <span className="text-sm font-medium">{t.title}</span>
        <ContentStatus table="topics" id={t.id} status={t.status} onChange={reload} />
        <div className="flex-1" />
        <button className="ink-2 text-xs underline" onClick={() => setModal({ title: "Edit topic", fields: [{ key: "title", label: "Title", required: true }, { key: "summary", label: "Summary", type: "textarea" }], initial: t, submit: async (v) => { must(await supabase.from("topics").update({ title: v.title, summary: v.summary || null }).eq("id", t.id)); reload(); } })}>Edit</button>
        {!t.parent_topic_id && <button className="ink-2 text-xs underline" onClick={() => setModal(topicModal(t.module_id, t.id, children.length, reload))}>+ Subtopic</button>}
        <button className="text-xs font-semibold text-brand-700 underline dark:text-brand-300" onClick={() => setModal({
          title: "New note", fields: [{ key: "title", label: "Note title", required: true }, { key: "kind", label: "Type", type: "select", options: [["note", "Study note"], ["handout", "Handout"]] }, { key: "is_demo", label: "Demonstration content", type: "checkbox" }],
          initial: { kind: "note" }, submit: createNote,
        })}>+ Note</button>
      </div>
      {notes.length > 0 && (
        <ul className="ml-8 mt-1 space-y-0.5">
          {notes.map((n, ni) => (
            <li key={n.id} className="flex items-center gap-2 text-sm">
              <ReorderButtons table="notes" list={notes} index={ni} onDone={reload} />
              <Icon name="book" size={14} className="ink-2" />
              <Link to={`/admin/notes/${n.id}`} className="hover:underline">{n.title}</Link>
              <StatusBadge status={n.status} />{n.kind === "handout" && <Badge>handout</Badge>}{n.is_demo && <DemoBadge />}
            </li>
          ))}
        </ul>
      )}
      {children.length > 0 && (
        <ul className="mt-1">
          {children.map((c, ci) => <TopicRow key={c.id} topic={c} index={ci} siblings={children} data={data} reload={reload} setModal={setModal} openNote={openNote} depth={1} />)}
        </ul>
      )}
    </li>
  );
}

function ReviewQueue() {
  const { data, error, loading, reload } = useAsync(async () =>
    must(await supabase.from("note_versions").select("id, note_id, version, change_summary, created_at, notes(title)").eq("status", "in_review").order("created_at")) as unknown as
      Array<{ id: string; note_id: string; version: number; change_summary: string | null; created_at: string; notes: { title: string } | null }>, []);
  const due = useAsync(async () =>
    must(await supabase.from("note_versions").select("id, note_id, version, review_due_at, notes(title)").eq("status", "approved").lte("review_due_at", new Date().toISOString().slice(0, 10)).order("review_due_at")) as unknown as
      Array<{ id: string; note_id: string; version: number; review_due_at: string; notes: { title: string } | null }>, []);
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card>
        <h2 className="mb-3 font-semibold">Awaiting clinical review</h2>
        {!data?.length ? <p className="ink-2 text-sm">Nothing waiting.</p> : (
          <ul className="space-y-2">{data.map((v) => (
            <li key={v.id} className="flex items-center justify-between gap-2 text-sm">
              <span>{v.notes?.title} · v{v.version}<span className="ink-2 block text-xs">{v.change_summary}</span></span>
              <Link to={`/admin/notes/${v.note_id}?version=${v.id}`}><Button size="sm">Review</Button></Link>
            </li>
          ))}</ul>
        )}
      </Card>
      <Card>
        <h2 className="mb-3 font-semibold">Scheduled re-review due</h2>
        {!due.data?.length ? <p className="ink-2 text-sm">No published notes are due for re-review.</p> : (
          <ul className="space-y-2">{due.data.map((v) => (
            <li key={v.id} className="flex items-center justify-between text-sm">
              <span>{v.notes?.title} · v{v.version}</span><span className="ink-2 text-xs">due {dateShort(v.review_due_at)}</span>
              <Link to={`/admin/notes/${v.note_id}`} className="underline">Open</Link>
            </li>
          ))}</ul>
        )}
      </Card>
    </div>
  );
}

function CurriculumVersions() {
  const { programmes } = useAuth();
  const [modal, setModal] = useState<ModalState>(null);
  const { data, error, loading, reload } = useAsync(async () =>
    must(await supabase.from("curriculum_versions").select("*").order("created_at", { ascending: false })) as Array<{
      id: string; programme_id: string; label: string; source: string | null; effective_from: string | null; status: PublicationStatus; notes: string | null; reviewed_at: string | null;
    }>, []);
  const fields: FieldDef[] = [
    { key: "programme_id", label: "Programme", type: "select", options: programmes.map((p) => [p.id, `${p.name} (${p.code})`]) },
    { key: "label", label: "Label", required: true, hint: "e.g. RN Curriculum 2025 revision" },
    { key: "source", label: "Source", hint: "Official document title / link you verified" },
    { key: "effective_from", label: "Effective from", type: "date" },
    { key: "notes", label: "Notes", type: "textarea" },
  ];
  const save = (id?: string) => async (v: Record<string, unknown>) => {
    const payload = { programme_id: v.programme_id, label: v.label, source: v.source || null, effective_from: v.effective_from || null, notes: v.notes || null };
    if (id) must(await supabase.from("curriculum_versions").update(payload).eq("id", id));
    else must(await supabase.from("curriculum_versions").insert(payload));
    reload();
  };
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <p className="ink-2 text-sm">Record which official curriculum each programme follows. Only reviewers can publish a version.</p>
        <Button size="sm" icon="plus" onClick={() => setModal({ title: "New curriculum version", fields, initial: { programme_id: programmes[0]?.id }, submit: save() })}>Version</Button>
      </div>
      <table className="w-full text-sm">
        <thead className="ink-2 text-left text-xs uppercase"><tr><th className="py-2">Programme</th><th>Label</th><th>Source</th><th>Effective</th><th>Status</th><th /></tr></thead>
        <tbody>{data?.map((v) => (
          <tr key={v.id} className="border-t line">
            <td className="py-2">{programmes.find((p) => p.id === v.programme_id)?.code}</td><td>{v.label}</td><td className="ink-2">{v.source}</td>
            <td>{dateShort(v.effective_from)}</td><td><ContentStatus table="curriculum_versions" id={v.id} status={v.status} onChange={reload} /></td>
            <td><button className="underline" onClick={() => setModal({ title: "Edit version", fields, initial: v, submit: save(v.id) })}>Edit</button></td>
          </tr>
        ))}</tbody>
      </table>
      {modal && <FormModal title={modal.title} fields={modal.fields} initial={modal.initial} onSubmit={modal.submit} onClose={() => setModal(null)} />}
    </Card>
  );
}
