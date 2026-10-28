import { useAuth } from "../auth/AuthProvider";
import { Icon, type IconName } from "../components/Icon";
import { Card, ErrorBox, Loading, ProgressBar } from "../components/ui";
import { api } from "../lib/api";
import { daysUntil, pct } from "../lib/format";
import { Link } from "../lib/router";
import { useAsync } from "../lib/useAsync";

const SECTIONS: Array<{ to: string; letter: string; title: string; body: string; icon: IconName; paid?: boolean }> = [
  { to: "/library", letter: "A", title: "Study Library", body: "Notes and handouts by course and topic, with AI explanations.", icon: "book" },
  { to: "/practice", letter: "B", title: "Question Bank", body: "Practise 10–100 questions with a rationale for every option.", icon: "quiz" },
  { to: "/mock", letter: "C", title: "Mock Examination", body: "Timed Papers 1–3 plus Paper 4 viva and CAOSCE practice.", icon: "clipboard", paid: true },
  { to: "/final", letter: "D", title: "Final Exam Simulator", body: "Separate full-length simulations and readiness tracking.", icon: "award", paid: true },
  { to: "/dashboard", letter: "E", title: "My Dashboard", body: "Progress, weak topics, goals, flashcards and history.", icon: "chart" },
];

export default function HomePage() {
  const { profile, programme } = useAuth();
  const { data, error, loading, reload } = useAsync(() => api.dashboard(), []);
  const days = daysUntil(profile?.exam_target_date);
  const first = (profile?.full_name ?? "").split(" ")[0];
  const accuracy = data && data.practice.answered ? (100 * data.practice.correct) / data.practice.answered : null;
  const lastNote = data?.recent_notes[0];
  const openPractice = data?.recent_practice.find((p) => p.status === "in_progress" && p.answered_count > 0);

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-brand-800 to-brand-600 p-6 text-white sm:p-8">
        <div className="text-sm text-white/80">{programme ? `${programme.name} · ${programme.code}` : "Welcome"}</div>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{first ? `Good to see you, ${first}.` : "Good to see you."}</h1>
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          {days !== null && days >= 0 && <span className="rounded-full bg-white/15 px-3 py-1"><b>{days}</b> days to your exam</span>}
          {data && <span className="rounded-full bg-white/15 px-3 py-1"><b>{data.streak_days}</b>-day study streak</span>}
          {accuracy !== null && <span className="rounded-full bg-white/15 px-3 py-1"><b>{pct(accuracy)}</b> practice accuracy</span>}
        </div>
      </section>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Loading />}

      {(lastNote || openPractice) && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide ink-2">Continue where you stopped</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {lastNote && (
              <Link to={`/library/note/${lastNote.note_id}`}>
                <Card className="h-full hover:border-brand-400">
                  <div className="ink-2 text-xs">Reading</div>
                  <div className="mt-1 font-semibold">{lastNote.title}</div>
                  <div className="mt-3"><ProgressBar value={lastNote.percent} label="Reading progress" /></div>
                </Card>
              </Link>
            )}
            {openPractice && (
              <Link to={`/practice/session/${openPractice.id}`}>
                <Card className="h-full hover:border-brand-400">
                  <div className="ink-2 text-xs">Practice session</div>
                  <div className="mt-1 font-semibold">{openPractice.answered_count} of {openPractice.question_count} answered</div>
                  <div className="mt-3"><ProgressBar value={openPractice.answered_count} max={openPractice.question_count} label="Session progress" /></div>
                </Card>
              </Link>
            )}
          </div>
        </section>
      )}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((s) => {
          const unlocked = s.letter === "C" ? data?.entitlements.some((e) => e.product_code === "section_c")
            : s.letter === "D" ? data?.entitlements.some((e) => e.product_code === "section_d") : true;
          return (
            <Link key={s.to} to={s.to}>
              <Card className="group h-full transition-colors hover:border-brand-400">
                <div className="flex items-start justify-between">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-brand-200"><Icon name={s.icon} size={22} /></span>
                  <span className="text-3xl font-black text-[var(--line)] group-hover:text-brand-200 dark:group-hover:text-brand-800">{s.letter}</span>
                </div>
                <h3 className="mt-3 font-semibold">{s.title} {s.paid && !unlocked && <Icon name="lock" size={14} className="ml-1 inline text-accent-600" />}</h3>
                <p className="ink-2 mt-1 text-sm">{s.body}</p>
              </Card>
            </Link>
          );
        })}
      </section>

      {data && data.weak_topics.length > 0 && (
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Topics to strengthen</h2>
            <Link to="/dashboard" className="text-sm font-medium text-brand-700 dark:text-brand-300">See all</Link>
          </div>
          <ul className="space-y-3">
            {data.weak_topics.slice(0, 3).map((t) => (
              <li key={t.topic_id} className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{t.topic}</div>
                  <ProgressBar value={t.accuracy} tone={t.accuracy < 50 ? "danger" : "accent"} label={`${t.topic} accuracy`} />
                </div>
                <span className="w-12 text-right text-sm font-semibold">{pct(t.accuracy)}</span>
                <Link to={`/practice?topic=${t.topic_id}`} className="text-sm font-medium text-brand-700 dark:text-brand-300">Practise</Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
