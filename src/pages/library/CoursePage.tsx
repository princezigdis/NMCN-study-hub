import { type ReactNode, useState } from "react";
import { Icon } from "../../components/Icon";
import { Button, Card, cx, DemoBadge, EmptyState, ErrorBox, Loading, PageHeader } from "../../components/ui";
import { Link, useParams } from "../../lib/router";
import { supabase } from "../../lib/supabase";
import type { Course, Module, Note, Topic } from "../../lib/types";
import { useAsync } from "../../lib/useAsync";

interface CourseTree {
  course: Course;
  modules: Array<Module & { topics: Array<Topic & { children: Topic[] }> }>;
  notesByTopic: Map<string, Note[]>;
  progress: Map<string, { percent: number; completed: boolean }>;
}

export default function CoursePage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useAsync<CourseTree>(async () => {
    const { data: course, error: ce } = await supabase.from("courses").select("*").eq("id", id).single();
    if (ce) throw new Error("note_not_found");
    const { data: modules } = await supabase.from("modules").select("*").eq("course_id", id).eq("status", "published").order("position");
    const moduleIds = (modules ?? []).map((m) => m.id);
    const { data: topics } = moduleIds.length
      ? await supabase.from("topics").select("*").in("module_id", moduleIds).eq("status", "published").order("position")
      : { data: [] as Topic[] };
    const topicIds = (topics ?? []).map((t) => t.id);
    const { data: notes } = topicIds.length
      ? await supabase.from("notes").select("*").in("topic_id", topicIds).eq("status", "published").order("position")
      : { data: [] as Note[] };
    const noteIds = (notes ?? []).map((n) => n.id);
    const { data: prog } = noteIds.length
      ? await supabase.from("reading_progress").select("note_id, percent, completed").in("note_id", noteIds)
      : { data: [] as Array<{ note_id: string; percent: number; completed: boolean }> };

    const ts = (topics ?? []) as Topic[];
    const tree = ((modules ?? []) as Module[]).map((m) => ({
      ...m,
      topics: ts.filter((t) => t.module_id === m.id && !t.parent_topic_id)
        .map((t) => ({ ...t, children: ts.filter((c) => c.parent_topic_id === t.id) })),
    }));
    const notesByTopic = new Map<string, Note[]>();
    for (const n of (notes ?? []) as Note[]) notesByTopic.set(n.topic_id, [...(notesByTopic.get(n.topic_id) ?? []), n]);
    return {
      course: course as Course, modules: tree, notesByTopic,
      progress: new Map((prog ?? []).map((p) => [p.note_id, { percent: p.percent, completed: p.completed }])),
    };
  }, [id]);

  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? "Course not found"} onRetry={reload} />;
  const { course } = data;

  return (
    <div>
      <Link to="/library" className="ink-2 mb-3 inline-flex items-center gap-1 text-sm hover:underline"><Icon name="chevronLeft" size={16} />Library</Link>
      <PageHeader eyebrow={course.code} title={<>{course.title} {course.is_demo && <DemoBadge />}</>} subtitle={course.description}
        actions={<Link to={`/practice?course=${course.id}`}><Button icon="quiz" variant="secondary">Practise this course</Button></Link>} />
      {!data.modules.length && <EmptyState title="No modules yet">Content for this course is being prepared.</EmptyState>}
      <div className="space-y-4">
        {data.modules.map((m, i) => <ModuleBlock key={m.id} index={i + 1} module={m} data={data} />)}
      </div>
    </div>
  );
}

function ModuleBlock({ module: m, index, data }: { module: CourseTree["modules"][number]; index: number; data: CourseTree }) {
  const [open, setOpen] = useState(index === 1);
  return (
    <Card className="p-0 sm:p-0">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-3 px-5 py-4 text-left">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-700 text-sm font-bold text-white">{index}</span>
        <span className="flex-1"><span className="block font-semibold">{m.title}</span>{m.description && <span className="ink-2 block text-sm">{m.description}</span>}</span>
        <Icon name="chevronDown" className={cx("transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-4 border-t line px-5 py-4">
          {!m.topics.length && <p className="ink-2 text-sm">No topics published yet.</p>}
          {m.topics.map((t) => (
            <TopicBlock key={t.id} topic={t} data={data}>
              {t.children.map((c) => <TopicBlock key={c.id} topic={c} data={data} sub />)}
            </TopicBlock>
          ))}
        </div>
      )}
    </Card>
  );
}

function TopicBlock({ topic, data, sub, children }: { topic: Topic; data: CourseTree; sub?: boolean; children?: ReactNode }) {
  const notes = data.notesByTopic.get(topic.id) ?? [];
  return (
    <div className={cx(sub && "ml-4 border-l-2 line pl-4")}>
      <div className="flex items-center justify-between gap-2">
        <h3 className={cx("font-semibold", sub && "text-sm")}>{topic.title}</h3>
        <Link to={`/practice?topic=${topic.id}`} className="shrink-0 text-xs font-medium text-brand-700 dark:text-brand-300">Practise</Link>
      </div>
      {topic.summary && <p className="ink-2 text-sm">{topic.summary}</p>}
      <ul className="mt-2 space-y-1">
        {notes.map((n) => {
          const p = data.progress.get(n.id);
          return (
            <li key={n.id}>
              <Link to={`/library/note/${n.id}`} className="flex items-center gap-2 rounded-lg border line px-3 py-2 text-sm font-medium hover:border-brand-400 hover:bg-[var(--surface-2)]">
                <Icon name={p?.completed ? "checkCircle" : "book"} size={16} className={p?.completed ? "text-emerald-600" : "text-brand-700"} />
                <span className="flex-1">{n.kind === "handout" ? "Handout: " : "Read note: "}{n.title}</span>
                {p && !p.completed && <span className="ink-2 text-xs">{p.percent}%</span>}
                <Icon name="chevronRight" size={16} className="ink-2" />
              </Link>
            </li>
          );
        })}
      </ul>
      {children && <div className="mt-3 space-y-3">{children}</div>}
    </div>
  );
}
