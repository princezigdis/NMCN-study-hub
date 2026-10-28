import { useState } from "react";
import { Icon } from "../../components/Icon";
import { Button, Card, ErrorBox, Input, Loading, PageHeader, Select, StatusBadge, useToast } from "../../components/ui";
import { friendly } from "../../lib/errors";
import { Link, useParams } from "../../lib/router";
import { supabase } from "../../lib/supabase";
import { useAsync } from "../../lib/useAsync";
import { must } from "./adminKit";

interface Q { id: string; stem: string; status: string; difficulty: string; topics: { title: string } | null }

/** Add/remove questions in an exam pool. Only questions from the same bank are offered. */
export default function AdminPoolEditor() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [topic, setTopic] = useState("");
  const pool = useAsync(async () => must(await supabase.from("question_pools").select("*").eq("id", id).single()) as { id: string; name: string; bank: string; description: string | null }, [id]);
  const members = useAsync(async () => (must(await supabase.from("question_pool_items").select("questions(id, stem, status, difficulty, topics(title))").eq("pool_id", id)) as unknown as Array<{ questions: Q }>).map((r) => r.questions), [id]);
  const topics = useAsync(async () => must(await supabase.from("topics").select("id, title").order("title")) as Array<{ id: string; title: string }>, []);
  const candidates = useAsync(async () => {
    if (!pool.data) return [];
    let q = supabase.from("questions").select("id, stem, status, difficulty, topics(title)").eq("bank", pool.data.bank).neq("status", "archived").limit(100);
    if (search.trim()) q = q.ilike("stem", `%${search.trim().replace(/[%_]/g, "")}%`);
    if (topic) q = q.eq("topic_id", topic);
    return must(await q) as unknown as Q[];
  }, [pool.data?.bank, search, topic]);

  const memberIds = new Set((members.data ?? []).map((m) => m.id));
  const add = async (ids: string[]) => {
    const rows = ids.filter((q) => !memberIds.has(q)).map((question_id) => ({ pool_id: id, question_id }));
    if (!rows.length) return;
    const { error } = await supabase.from("question_pool_items").insert(rows);
    if (error) return toast(friendly(error), "error");
    toast(`${rows.length} added`);
    members.reload();
  };
  const remove = async (qid: string) => {
    await supabase.from("question_pool_items").delete().eq("pool_id", id).eq("question_id", qid);
    members.reload();
  };

  if (pool.loading) return <Loading />;
  if (pool.error || !pool.data) return <ErrorBox message={pool.error ?? "Pool not found"} />;
  const published = (members.data ?? []).filter((m) => m.status === "published").length;

  return (
    <div>
      <Link to="/admin/exams" className="ink-2 mb-3 inline-flex items-center gap-1 text-sm hover:underline"><Icon name="chevronLeft" size={16} />Exams</Link>
      <PageHeader eyebrow={`${pool.data.bank.replace("_", " ")} pool`} title={pool.data.name} subtitle={`${members.data?.length ?? 0} questions (${published} published and eligible for exams)`} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">In this pool</h2>
          {members.loading ? <Loading /> : (
            <ul className="max-h-[70vh] space-y-2 overflow-y-auto">
              {members.data?.map((q) => (
                <li key={q.id} className="flex items-start gap-2 text-sm">
                  <span className="flex-1">{q.stem.slice(0, 160)}<span className="ink-2 block text-xs">{q.topics?.title} · {q.difficulty}</span></span>
                  <StatusBadge status={q.status} />
                  <button className="text-xs text-red-600" onClick={() => remove(q.id)}>Remove</button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Add questions from the {pool.data.bank.replace("_", " ")} bank</h2>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <Input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search questions" />
            <Select value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="Topic"><option value="">All topics</option>{topics.data?.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</Select>
          </div>
          <Button size="sm" variant="secondary" className="mb-3" onClick={() => add((candidates.data ?? []).map((q) => q.id))}>Add all {candidates.data?.length ?? 0} shown</Button>
          <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
            {candidates.data?.map((q) => (
              <li key={q.id} className="flex items-start gap-2 text-sm">
                <span className="flex-1">{q.stem.slice(0, 160)}<span className="ink-2 block text-xs">{q.topics?.title} · {q.difficulty}</span></span>
                <StatusBadge status={q.status} />
                {memberIds.has(q.id) ? <span className="ink-2 text-xs">added</span> : <button className="text-xs font-semibold text-brand-700 dark:text-brand-300" onClick={() => add([q.id])}>Add</button>}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
