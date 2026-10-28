import { useState } from "react";
import { Button, Card, ErrorBox, Field, Input, Loading, PageHeader, Select, useToast } from "../../components/ui";
import { friendly } from "../../lib/errors";
import { supabase } from "../../lib/supabase";
import { useAsync } from "../../lib/useAsync";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface Entry { id: string; day_of_week: number; start_time: string; end_time: string; title: string; course_id: string | null }
interface Goal { id: string; period: "daily" | "weekly"; metric: string; target: number; active: boolean }

export default function PlannerPage() {
  const toast = useToast();
  const timetable = useAsync(async () => {
    const { data, error } = await supabase.from("timetable_entries").select("*").order("day_of_week").order("start_time");
    if (error) throw error;
    return data as Entry[];
  }, []);
  const goals = useAsync(async () => {
    const { data, error } = await supabase.from("study_goals").select("*").order("period");
    if (error) throw error;
    return data as Goal[];
  }, []);
  const courses = useAsync(async () => (await supabase.from("courses").select("id, code, title").eq("status", "published").order("position")).data ?? [], []);

  const [form, setForm] = useState({ day: new Date().getDay(), start: "18:00", end: "19:00", title: "", course: "" });
  const [goal, setGoal] = useState({ period: "daily", metric: "questions", target: 20 });
  const [minutes, setMinutes] = useState(30);

  const uid = async () => (await supabase.auth.getUser()).data.user?.id;

  const addEntry = async () => {
    if (!form.title.trim()) return toast("Give the session a title", "error");
    if (form.end <= form.start) return toast("End time must be after start time", "error");
    const { error } = await supabase.from("timetable_entries").insert({
      user_id: await uid(), day_of_week: form.day, start_time: form.start, end_time: form.end,
      title: form.title.trim(), course_id: form.course || null,
    });
    if (error) return toast(friendly(error), "error");
    setForm((f) => ({ ...f, title: "" }));
    timetable.reload();
  };

  const saveGoal = async () => {
    const { error } = await supabase.from("study_goals").upsert({
      user_id: await uid(), period: goal.period, metric: goal.metric, target: goal.target, active: true,
    }, { onConflict: "user_id,period,metric" });
    if (error) return toast(friendly(error), "error");
    toast("Goal saved");
    goals.reload();
  };

  const logMinutes = async () => {
    const { error } = await supabase.from("study_activity").insert({ user_id: await uid(), kind: "study_minutes", amount: Math.min(600, Math.max(1, minutes)) });
    if (error) return toast(friendly(error), "error");
    toast(`${minutes} minutes logged`);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader eyebrow="Section E" title="Study planner" subtitle="Plan your week, set goals and log study time." />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="mb-3 font-semibold">Weekly timetable</h2>
          {timetable.loading ? <Loading /> : timetable.error ? <ErrorBox message={timetable.error} /> : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {DAYS.map((d, i) => {
                const list = (timetable.data ?? []).filter((e) => e.day_of_week === i);
                return (
                  <div key={d} className={`rounded-xl border line p-3 ${i === new Date().getDay() ? "border-brand-400" : ""}`}>
                    <div className="mb-1 text-sm font-semibold">{d}</div>
                    {!list.length ? <div className="ink-2 text-xs">Free</div> : list.map((e) => (
                      <div key={e.id} className="flex items-center justify-between gap-2 text-sm">
                        <span><span className="font-mono text-xs">{e.start_time.slice(0, 5)}–{e.end_time.slice(0, 5)}</span> {e.title}</span>
                        <button className="ink-2 text-xs underline" onClick={async () => { await supabase.from("timetable_entries").delete().eq("id", e.id); timetable.reload(); }}>Remove</button>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
          <div className="mt-4 grid grid-cols-1 gap-3 border-t line pt-4 sm:grid-cols-5">
            <Field label="Day">{(id) => <Select id={id} value={form.day} onChange={(e) => setForm({ ...form, day: Number(e.target.value) })}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</Select>}</Field>
            <Field label="Start">{(id) => <Input id={id} type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />}</Field>
            <Field label="End">{(id) => <Input id={id} type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />}</Field>
            <Field label="What">{(id) => <Input id={id} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Obstetrics revision" maxLength={120} />}</Field>
            <Field label="Course">{(id) => (
              <Select id={id} value={form.course} onChange={(e) => setForm({ ...form, course: e.target.value })}>
                <option value="">—</option>{(courses.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
              </Select>
            )}</Field>
          </div>
          <Button className="mt-3" icon="plus" onClick={addEntry}>Add to timetable</Button>
        </Card>

        <div className="space-y-6">
          <Card>
            <h2 className="mb-3 font-semibold">Goals</h2>
            <ul className="mb-4 space-y-2 text-sm">
              {(goals.data ?? []).map((g) => (
                <li key={g.id} className="flex items-center justify-between">
                  <span>{g.period === "daily" ? "Daily" : "Weekly"}: {g.target} {g.metric}</span>
                  <button className="ink-2 text-xs underline" onClick={async () => { await supabase.from("study_goals").delete().eq("id", g.id); goals.reload(); }}>Remove</button>
                </li>
              ))}
              {!goals.data?.length && <li className="ink-2">No goals yet.</li>}
            </ul>
            <div className="grid grid-cols-3 gap-2">
              <Select aria-label="Period" value={goal.period} onChange={(e) => setGoal({ ...goal, period: e.target.value })}><option value="daily">Daily</option><option value="weekly">Weekly</option></Select>
              <Input aria-label="Target" type="number" min={1} max={10000} value={goal.target} onChange={(e) => setGoal({ ...goal, target: Number(e.target.value) })} />
              <Select aria-label="Metric" value={goal.metric} onChange={(e) => setGoal({ ...goal, metric: e.target.value })}>
                <option value="questions">questions</option><option value="notes">notes</option><option value="flashcards">flashcards</option><option value="minutes">minutes</option>
              </Select>
            </div>
            <Button className="mt-3 w-full" variant="secondary" onClick={saveGoal}>Save goal</Button>
          </Card>
          <Card>
            <h2 className="mb-3 font-semibold">Log study time</h2>
            <div className="flex gap-2">
              <Input type="number" min={1} max={600} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} aria-label="Minutes" />
              <Button onClick={logMinutes}>Log minutes</Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
