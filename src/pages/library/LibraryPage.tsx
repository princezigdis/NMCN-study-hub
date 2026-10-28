import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { Icon } from "../../components/Icon";
import { Card, cx, DemoBadge, EmptyState, ErrorBox, Input, Loading, PageHeader, ProgressBar } from "../../components/ui";
import { api } from "../../lib/api";
import { relative } from "../../lib/format";
import { Link, useSearchParams } from "../../lib/router";
import { supabase } from "../../lib/supabase";
import type { Course } from "../../lib/types";
import { useAsync } from "../../lib/useAsync";

type CourseRow = Course & { course_programmes: Array<{ programmes: { code: string } | null }> };

export default function LibraryPage() {
  const { programme } = useAuth();
  const [params, setParams] = useSearchParams();
  const prog = params.get("programme") ?? programme?.code ?? "all";
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [debounced, setDebounced] = useState(query);

  useEffect(() => { const t = setTimeout(() => setDebounced(query.trim()), 350); return () => clearTimeout(t); }, [query]);
  useEffect(() => { setParams({ q: debounced || null }); }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps

  const courses = useAsync(async () => {
    const { data, error } = await supabase.from("courses")
      .select("*, course_programmes(programmes(code))").eq("status", "published").order("position");
    if (error) throw error;
    return data as unknown as CourseRow[];
  }, []);

  const recent = useAsync(async () => {
    const { data } = await supabase.from("reading_progress").select("percent, last_viewed_at, notes(id, title)")
      .order("last_viewed_at", { ascending: false }).limit(4);
    return (data ?? []) as unknown as Array<{ percent: number; last_viewed_at: string; notes: { id: string; title: string } | null }>;
  }, []);

  const bookmarks = useAsync(async () => {
    const { data } = await supabase.from("bookmarks").select("id, notes(id, title)").not("note_id", "is", null)
      .order("created_at", { ascending: false }).limit(6);
    return (data ?? []) as unknown as Array<{ id: string; notes: { id: string; title: string } | null }>;
  }, []);

  const search = useAsync(() => (debounced.length >= 2 ? api.searchNotes(debounced, prog === "all" ? null : prog) : Promise.resolve(null)), [debounced, prog]);

  const filtered = useMemo(() => (courses.data ?? []).filter((c) =>
    prog === "all" || c.course_programmes.some((cp) => cp.programmes?.code === prog)), [courses.data, prog]);
  const byLevel = useMemo(() => {
    const m = new Map<string, CourseRow[]>();
    for (const c of filtered) {
      const k = c.level || "Courses";
      m.set(k, [...(m.get(k) ?? []), c]);
    }
    return [...m.entries()];
  }, [filtered]);

  return (
    <div>
      <PageHeader eyebrow="Section A" title="Study Library" subtitle="Notes and handouts organised by the curriculum. Select any passage to ask the AI assistant." />

      <div className="mb-5 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Icon name="search" size={18} className="ink-2 absolute left-3 top-1/2 -translate-y-1/2" />
          <Input placeholder="Search notes, e.g. pre-eclampsia, wound care…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-10" aria-label="Search notes" />
        </div>
        <div className="flex rounded-lg border line surface p-1" role="group" aria-label="Programme filter">
          {["all", "RN", "RM"].map((p) => (
            <button key={p} onClick={() => setParams({ programme: p })} aria-pressed={prog === p}
              className={cx("rounded-md px-3 py-1 text-sm font-medium", prog === p ? "bg-brand-700 text-white" : "ink-2")}>
              {p === "all" ? "All" : p}
            </button>
          ))}
        </div>
      </div>

      {debounced.length >= 2 ? (
        <section>
          <h2 className="mb-3 font-semibold">Results for “{debounced}”</h2>
          {search.loading ? <Loading label="Searching…" /> : search.error ? <ErrorBox message={search.error} /> : !search.data?.length ? (
            <EmptyState icon="search" title="No matching notes">Try a broader term or check the spelling.</EmptyState>
          ) : (
            <ul className="space-y-2">
              {search.data.map((r) => (
                <li key={r.note_id}>
                  <Link to={`/library/note/${r.note_id}?q=${encodeURIComponent(debounced)}`}>
                    <Card className="hover:border-brand-400">
                      <div className="ink-2 text-xs">{r.course} · {r.topic}</div>
                      <div className="font-semibold">{r.title}</div>
                      <p className="ink-2 mt-1 text-sm" dangerouslySetInnerHTML={{ __html: escapeHighlight(r.snippet) }} />
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
          <div className="space-y-6">
            {courses.loading && <Loading />}
            {courses.error && <ErrorBox message={courses.error} onRetry={courses.reload} />}
            {!courses.loading && !filtered.length && <EmptyState title="No courses yet">Your administrators haven't published courses for this programme yet.</EmptyState>}
            {byLevel.map(([level, list]) => (
              <section key={level}>
                <h2 className="ink-2 mb-3 text-sm font-semibold uppercase tracking-wide">{level}</h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {list.map((c) => (
                    <Link key={c.id} to={`/library/course/${c.id}`}>
                      <Card className="h-full hover:border-brand-400">
                        <div className="flex items-center gap-2">
                          <span className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-bold text-brand-800 dark:bg-brand-900 dark:text-brand-100">{c.code}</span>
                          {c.course_programmes.map((cp) => cp.programmes?.code).filter(Boolean).map((code) => <span key={code} className="ink-2 text-xs">{code}</span>)}
                          {c.is_demo && <DemoBadge />}
                        </div>
                        <div className="mt-2 font-semibold">{c.title}</div>
                        {c.description && <p className="ink-2 mt-1 line-clamp-2 text-sm">{c.description}</p>}
                      </Card>
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>
          <aside className="space-y-4">
            <Card>
              <h3 className="mb-3 text-sm font-semibold">Recently viewed</h3>
              {!recent.data?.length ? <p className="ink-2 text-sm">Notes you open will appear here.</p> : (
                <ul className="space-y-3">
                  {recent.data.filter((r) => r.notes).map((r) => (
                    <li key={r.notes!.id}>
                      <Link to={`/library/note/${r.notes!.id}`} className="block text-sm font-medium hover:underline">{r.notes!.title}</Link>
                      <div className="mt-1 flex items-center gap-2"><ProgressBar value={r.percent} label="Progress" /><span className="ink-2 shrink-0 text-xs">{relative(r.last_viewed_at)}</span></div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <h3 className="mb-3 text-sm font-semibold">Bookmarked notes</h3>
              {!bookmarks.data?.length ? <p className="ink-2 text-sm">Tap the bookmark icon on a note to save it here.</p> : (
                <ul className="space-y-2">
                  {bookmarks.data.filter((b) => b.notes).map((b) => (
                    <li key={b.id}><Link to={`/library/note/${b.notes!.id}`} className="flex items-center gap-2 text-sm hover:underline"><Icon name="bookmark" size={14} className="text-accent-500" />{b.notes!.title}</Link></li>
                  ))}
                </ul>
              )}
            </Card>
            <Link to="/my-notes" className="block"><Card className="hover:border-brand-400"><div className="flex items-center gap-2 text-sm font-semibold"><Icon name="edit" size={16} />My personal notes</div></Card></Link>
          </aside>
        </div>
      )}
    </div>
  );
}

/** ts_headline marks matches with **…**; escape everything else. */
function escapeHighlight(s: string): string {
  const esc = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.replace(/\*\*(.+?)\*\*/g, "<mark>$1</mark>");
}
