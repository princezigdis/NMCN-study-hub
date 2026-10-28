import { Icon } from "../../components/Icon";
import { Badge, Button, Card, EmptyState, ErrorBox, Loading, PageHeader, ProgressBar, Stat, StatusBadge } from "../../components/ui";
import { api } from "../../lib/api";
import { dateShort, daysUntil, pct, PRODUCT_LABEL, relative } from "../../lib/format";
import { Link } from "../../lib/router";
import { useAsync } from "../../lib/useAsync";

const METRIC_LABEL: Record<string, string> = { questions: "questions", notes: "notes read", flashcards: "flashcards", minutes: "minutes" };

export default function DashboardPage() {
  const { data, error, loading, reload } = useAsync(() => api.dashboard(), []);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? "Could not load"} onRetry={reload} />;

  const acc = data.practice.answered ? (100 * data.practice.correct) / data.practice.answered : null;
  const days = daysUntil(data.profile?.exam_target_date);
  const maxDay = Math.max(1, ...data.last_7_days.map((d) => d.questions));
  const w = data.wallet;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Section E" title="My Dashboard"
        subtitle={data.profile?.programme_name ? `${data.profile.programme_name}${data.profile.institution ? ` · ${data.profile.institution}` : ""}` : undefined}
        actions={<><Link to="/planner"><Button variant="secondary" icon="calendar">Planner & goals</Button></Link><Link to="/profile"><Button variant="ghost" icon="user">Profile</Button></Link></>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Questions answered" value={data.practice.answered} hint={acc !== null ? `${pct(acc)} correct` : "Start practising"} />
        <Stat label="Study streak" value={`${data.streak_days} day${data.streak_days === 1 ? "" : "s"}`} />
        <Stat label="Flashcards due" value={data.flashcards_due} hint={<Link to="/flashcards" className="underline">Review now</Link>} />
        <Stat label="Exam countdown" value={days !== null && days >= 0 ? `${days} days` : "—"} hint={data.profile?.exam_target_date ? dateShort(data.profile.exam_target_date) : <Link to="/profile" className="underline">Set a date</Link>} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="mb-4 font-semibold">Questions this week</h2>
          <div className="flex gap-2" role="img" aria-label="Questions answered per day over the last 7 days">
            {data.last_7_days.map((d) => (
              <div key={d.day} className="flex flex-1 flex-col items-center gap-1">
                <span className="ink-2 h-4 text-[10px]">{d.questions || ""}</span>
                <div className="flex h-28 w-full items-end">
                  <div className="w-full rounded-t-md bg-brand-500" style={{ height: `${Math.max(3, (d.questions / maxDay) * 100)}%`, opacity: d.questions ? 1 : 0.25 }} />
                </div>
                <span className="ink-2 text-[11px]">{new Date(`${d.day}T12:00:00`).toLocaleDateString("en-NG", { weekday: "short" })}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Goals</h2><Link to="/planner" className="text-sm text-brand-700 dark:text-brand-300">Edit</Link></div>
          {!data.goals.length ? <p className="ink-2 text-sm">Set daily or weekly goals in the planner.</p> : (
            <ul className="space-y-3">
              {data.goals.map((g) => (
                <li key={g.id}>
                  <div className="mb-1 flex justify-between text-sm"><span>{g.period === "daily" ? "Today" : "This week"}: {g.target} {METRIC_LABEL[g.metric]}</span><span className="font-semibold">{g.current}/{g.target}</span></div>
                  <ProgressBar value={g.current} max={g.target} label={`${g.metric} goal`} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Weak topics</h2>
          {!data.weak_topics.length ? <p className="ink-2 text-sm">Answer at least 3 questions in a topic to see analysis here.</p> : (
            <ul className="space-y-3">
              {data.weak_topics.map((t) => (
                <li key={t.topic_id} className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{t.topic}</div>
                    <div className="ink-2 text-xs">{t.course} · {t.correct}/{t.answered}</div>
                    <ProgressBar value={t.accuracy} tone={t.accuracy < 50 ? "danger" : "accent"} label={t.topic} />
                  </div>
                  <Link to={`/practice?topic=${t.topic_id}`}><Button size="sm" variant="secondary">Practise</Button></Link>
                </li>
              ))}
            </ul>
          )}
          {data.strong_topics.length > 0 && <p className="ink-2 mt-4 text-xs">Strongest: {data.strong_topics.map((t) => `${t.topic} (${pct(t.accuracy)})`).join(", ")}</p>}
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">Course progress</h2>
          {!data.course_progress.length ? <p className="ink-2 text-sm">Open notes in the library to track completion.</p> : (
            <ul className="space-y-3">
              {data.course_progress.map((c) => (
                <li key={c.course_id}>
                  <div className="mb-1 flex justify-between text-sm"><Link to={`/library/course/${c.course_id}`} className="hover:underline">{c.course}</Link><span className="ink-2">{c.notes_done}/{c.notes_total} notes</span></div>
                  <ProgressBar value={c.notes_done} max={c.notes_total} label={c.course} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <h2 className="mb-3 font-semibold">AI credits</h2>
          <div className="text-3xl font-bold">{w.balance}</div>
          <div className="ink-2 text-sm">of {w.monthly_credits} · {w.plan_name} plan · resets {dateShort(w.period_end)}</div>
          <ul className="ink-2 mt-3 space-y-1 text-xs">
            <li>Diagrams: {w.images_used}/{w.image_limit}</li>
            <li>Video searches: {w.video_searches_used}/{w.video_search_limit}</li>
            <li>Web searches: {w.web_searches_used}/{w.web_search_limit}</li>
          </ul>
          <Link to="/plans"><Button size="sm" className="mt-4" variant="accent" icon="sparkles">Get more credits</Button></Link>
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Exam access</h2>
          {["section_c", "section_d"].map((code) => {
            const e = data.entitlements.find((x) => x.product_code === code);
            return (
              <div key={code} className="mb-2 flex items-center justify-between text-sm">
                <span>{PRODUCT_LABEL[code]}</span>
                {e ? <Badge tone="success">{e.expires_at ? `Until ${dateShort(e.expires_at)}` : "Active"}</Badge>
                  : <Link to={code === "section_c" ? "/mock" : "/final"} className="text-brand-700 underline dark:text-brand-300">Unlock</Link>}
              </div>
            );
          })}
          {data.readiness.attempts > 0 && (
            <div className="mt-4 rounded-xl bg-brand-50 p-3 text-sm dark:bg-brand-900/40">
              <div className="font-semibold">Section D readiness: {data.readiness.label}</div>
              <div className="ink-2 text-xs">Average {pct(data.readiness.avg_percent)} over {data.readiness.attempts} attempt(s). Practice indicator only — not a prediction of your result.</div>
            </div>
          )}
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Recently read</h2>
          {!data.recent_notes.length ? <p className="ink-2 text-sm">Nothing yet.</p> : (
            <ul className="space-y-2">
              {data.recent_notes.map((n) => (
                <li key={n.note_id}><Link to={`/library/note/${n.note_id}`} className="block text-sm hover:underline">{n.title}</Link><span className="ink-2 text-xs">{n.percent}% · {relative(n.last_viewed_at)}</span></li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="mb-3 font-semibold">Mock & final exam history</h2>
        {!data.exam_history.length ? <EmptyState icon="clipboard" title="No exam attempts yet">Your Section C and D attempts will appear here.</EmptyState> : (
          <ul className="divide-y divide-[var(--line)]">
            {data.exam_history.map((h) => (
              <li key={h.id} className="flex items-center gap-3 py-2 text-sm">
                <Badge tone="brand">{h.section}</Badge>
                <span className="min-w-0 flex-1 truncate">{h.config} · {h.paper}</span>
                <StatusBadge status={h.status} />
                <span className="w-14 text-right font-semibold">{pct(h.percent)}</span>
                <Link to={h.status === "in_progress" ? `/exam/${h.id}` : `/exam/${h.id}/review`} aria-label="Open attempt"><Icon name="chevronRight" size={18} /></Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
