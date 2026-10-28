import { useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { Button, Card, cx, ErrorBox, Field, PageHeader, Select } from "../../components/ui";
import { api } from "../../lib/api";
import { friendly } from "../../lib/errors";
import { Link, useNavigate, useSearchParams } from "../../lib/router";
import { supabase } from "../../lib/supabase";
import type { Difficulty } from "../../lib/types";

const COUNTS = [10, 20, 25, 50, 100] as const;
const MODES = [
  { id: "random", label: "New mix", hint: "Random questions from the bank" },
  { id: "retry_incorrect", label: "Retry my mistakes", hint: "Questions you last got wrong" },
  { id: "saved", label: "Saved questions", hint: "Questions you bookmarked" },
] as const;

export default function PracticeSetupPage() {
  const { programme } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [count, setCount] = useState<number>(20);
  const [mode, setMode] = useState<string>(params.get("mode") ?? "random");
  const [prog, setProg] = useState<string>(programme?.code ?? "");
  const [courseId, setCourseId] = useState(params.get("course") ?? "");
  const [topicId, setTopicId] = useState(params.get("topic") ?? "");
  const [difficulty, setDifficulty] = useState<string>("");
  const [courses, setCourses] = useState<Array<{ id: string; code: string; title: string }>>([]);
  const [topics, setTopics] = useState<Array<{ id: string; title: string; course_id: string; parent: boolean }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("courses").select("id, code, title").eq("status", "published").order("position")
      .then(({ data }) => setCourses(data ?? []));
    supabase.from("topics").select("id, title, parent_topic_id, modules!inner(course_id)").eq("status", "published").order("position")
      .then(({ data }) => setTopics(((data ?? []) as unknown as Array<{ id: string; title: string; parent_topic_id: string | null; modules: { course_id: string } }>)
        .map((t) => ({ id: t.id, title: t.title, course_id: t.modules.course_id, parent: !t.parent_topic_id }))));
  }, []);

  // Preselect the course when arriving with ?topic=
  useEffect(() => {
    if (topicId && !courseId) {
      const t = topics.find((x) => x.id === topicId);
      if (t) setCourseId(t.course_id);
    }
  }, [topics, topicId, courseId]);

  const start = async () => {
    setBusy(true); setError(null);
    try {
      const res = await api.practiceStart({
        count, mode, programme: prog || null, courseId: courseId || null, topicId: topicId || null,
        difficulty: (difficulty || null) as Difficulty | null,
      });
      navigate(`/practice/session/${res.session_id}${res.question_count < res.requested ? `?short=${res.question_count}` : ""}`);
    } catch (e) {
      setError(friendly(e));
      setBusy(false);
    }
  };

  const courseTopics = topics.filter((t) => !courseId || t.course_id === courseId);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="Section B" title="Question Bank" subtitle="Answer each question to see why every option is right or wrong."
        actions={<Link to="/practice/history"><Button variant="secondary" icon="chart">History & saved</Button></Link>} />

      <Card className="space-y-6">
        <div>
          <div className="mb-2 text-sm font-semibold">How many questions?</div>
          <div className="grid grid-cols-5 gap-2">
            {COUNTS.map((c) => (
              <button key={c} onClick={() => setCount(c)} aria-pressed={count === c}
                className={cx("rounded-xl border-2 py-4 text-xl font-bold transition-colors", count === c ? "border-brand-600 bg-brand-50 text-brand-800 dark:bg-brand-900/50 dark:text-brand-100" : "line hover:border-brand-300")}>
                {c}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 text-sm font-semibold">Mode</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {MODES.map((m) => (
              <button key={m.id} onClick={() => setMode(m.id)} aria-pressed={mode === m.id}
                className={cx("rounded-xl border-2 p-3 text-left", mode === m.id ? "border-brand-600 bg-brand-50 dark:bg-brand-900/40" : "line hover:border-brand-300")}>
                <div className="text-sm font-semibold">{m.label}</div>
                <div className="ink-2 text-xs">{m.hint}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Programme">{(id) => (
            <Select id={id} value={prog} onChange={(e) => setProg(e.target.value)}>
              <option value="">RN and RM</option><option value="RN">RN only</option><option value="RM">RM only</option>
            </Select>
          )}</Field>
          <Field label="Difficulty">{(id) => (
            <Select id={id} value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
              <option value="">Any</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
            </Select>
          )}</Field>
          <Field label="Course">{(id) => (
            <Select id={id} value={courseId} onChange={(e) => { setCourseId(e.target.value); setTopicId(""); }}>
              <option value="">All courses</option>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.title}</option>)}
            </Select>
          )}</Field>
          <Field label="Topic">{(id) => (
            <Select id={id} value={topicId} onChange={(e) => setTopicId(e.target.value)}>
              <option value="">All topics</option>
              {courseTopics.map((t) => <option key={t.id} value={t.id}>{t.parent ? "" : "— "}{t.title}</option>)}
            </Select>
          )}</Field>
        </div>

        {error && <ErrorBox message={error} />}
        <Button size="lg" className="w-full" onClick={start} loading={busy} icon="play">Start {count} questions</Button>
      </Card>
    </div>
  );
}
